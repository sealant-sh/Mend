#!/usr/bin/env node
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * The mend CLI (plan §7.2): the terminal-first entry into the workbench.
 *
 *   mend adopt [source] [--name <name>]   clone a repo into the store
 *   mend codex|claude|opencode [...]      session worktree + launch the harness there
 *   mend run -- <command...>              same, arbitrary command
 *   mend status                           active sessions
 *
 * The CLI talks to the Mend server API; the server owns the store, the
 * engine, and the database. Until the platform ships store mounts and the
 * interactive PTY surface (PLATFORM-FEEDBACK.md 2026-07-25), the harness is
 * spawned directly in the worktree and the session is NOT recorded — the CLI
 * says so out loud. Worktree isolation, checkpoints, the diff, and review all
 * work; evidence arrives when recording does.
 *
 * Deliberately dependency-light: plain fetch + spawn, wire DTOs as plain
 * types (the server validates; the CLI renders).
 */

interface CliConfig {
  readonly url: string;
  readonly token: string | null;
}

interface ProjectDto {
  readonly id: string;
  readonly name: string;
  readonly originUrl: string | null;
  readonly storePath: string;
  readonly defaultBranch: string;
}

interface SessionDto {
  readonly id: string;
  readonly projectId: string;
  readonly harness: string;
  readonly worktree: string;
  readonly branch: string;
  readonly baseSha: string;
  readonly status: string;
}

const CONFIG_PATH = path.join(os.homedir(), ".mend", "cli.json");

const loadConfig = (): CliConfig => {
  let fileConfig: Partial<CliConfig> = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Partial<CliConfig>;
    } catch {
      fail(`could not parse ${CONFIG_PATH}`);
    }
  }
  return {
    url: process.env["MEND_URL"] ?? fileConfig.url ?? "http://localhost:3105",
    token: process.env["MEND_TOKEN"] ?? fileConfig.token ?? null,
  };
};

const fail = (message: string): never => {
  process.stderr.write(`mend: ${message}\n`);
  process.exit(1);
};

const paint = (code: string) => (text: string) =>
  process.stdout.isTTY ? `[${code}m${text}[0m` : text;
const dim = paint("2");
const green = paint("32");
const amber = paint("33");
const cobalt = paint("34");
const say = (line: string) => process.stdout.write(`${line}\n`);

const api = async <T>(
  config: CliConfig,
  method: "GET" | "POST",
  route: string,
  body?: unknown,
): Promise<T> => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (config.token !== null) headers["authorization"] = `Bearer ${config.token}`;
  let response: Response;
  try {
    response = await fetch(`${config.url}/api${route}`, {
      method,
      headers,
      body: body === undefined ? null : JSON.stringify(body),
    });
  } catch {
    return fail(`cannot reach the Mend server at ${config.url} — is it running?`);
  }
  if (response.status === 401) {
    return fail(
      `unauthorized — set MEND_TOKEN (or "token" in ${CONFIG_PATH}) to a bearer token for ${config.url}`,
    );
  }
  const text = await response.text();
  if (!response.ok) {
    try {
      const parsed = JSON.parse(text) as { readonly message?: string };
      return fail(parsed.message ?? `${method} ${route} → ${response.status}`);
    } catch {
      return fail(`${method} ${route} → ${response.status}`);
    }
  }
  return JSON.parse(text) as T;
};

const worktreePathOf = (storePath: string, worktree: string) =>
  path.join(path.dirname(storePath), "worktrees", worktree);

/** A live elapsed-time spinner around a slow await — provisioning is not a hang. */
const withSpinner = async <T>(label: string, work: Promise<T>): Promise<T> => {
  if (process.stdout.isTTY !== true) return work;
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const started = Date.now();
  let frame = 0;
  const timer = setInterval(() => {
    const seconds = Math.round((Date.now() - started) / 1000);
    process.stdout.write(`\r  ${frames[frame % frames.length]} ${label} ${dim(`${seconds}s`)} `);
    frame += 1;
  }, 120);
  try {
    return await work;
  } finally {
    clearInterval(timer);
    process.stdout.write("\r[2K");
  }
};

// ─── adopt ──────────────────────────────────────────────────────────────────

const adopt = async (config: CliConfig, args: ReadonlyArray<string>) => {
  const nameFlag = args.indexOf("--name");
  const name =
    nameFlag !== -1 && args[nameFlag + 1] !== undefined ? String(args[nameFlag + 1]) : null;
  const positional = args.filter(
    (a, i) => !a.startsWith("--") && (nameFlag === -1 || i !== nameFlag + 1),
  );
  const rawSource = positional[0] ?? ".";
  const source = /^(https?|git|ssh):|^git@/.test(rawSource) ? rawSource : path.resolve(rawSource);
  const projectName = name ?? path.basename(source, ".git");

  const project = await api<ProjectDto>(config, "POST", "/projects", {
    name: projectName,
    source,
  });
  say(`${green("✓")} adopted · ${project.name} · ${dim(project.storePath)}`);
  say(`${dim("  default branch")} ${project.defaultBranch}`);
  say(
    `${dim("  sessions start with:")} mend codex ${dim("(from anywhere —")} --project ${project.name}${dim(")")}`,
  );
};

// ─── session launch ─────────────────────────────────────────────────────────

const findProject = async (config: CliConfig, explicit: string | null) => {
  const projects = await api<ReadonlyArray<ProjectDto>>(config, "GET", "/projects");
  if (explicit !== null) {
    const named = projects.find((p) => p.name === explicit);
    if (named === undefined) return fail(`no adopted project named "${explicit}"`);
    return named;
  }
  const cwd = process.cwd();
  const byOrigin = projects.find((p) => p.originUrl !== null && cwd.startsWith(p.originUrl));
  const byName = projects.find((p) => p.name === path.basename(cwd));
  const project = byOrigin ?? byName;
  if (project === undefined) {
    return fail(
      `no adopted project matches ${cwd} — run "mend adopt" here first, or name one with --project`,
    );
  }
  return project;
};

const HARNESS_COMMANDS: Record<string, ReadonlyArray<string>> = {
  codex: ["codex"],
  claude: ["claude"],
  opencode: ["opencode"],
};

const launch = async (config: CliConfig, harness: string, args: ReadonlyArray<string>) => {
  const projectFlag = args.indexOf("--project");
  const explicit =
    projectFlag !== -1 && args[projectFlag + 1] !== undefined
      ? String(args[projectFlag + 1])
      : null;
  const dashdash = args.indexOf("--");
  const custom = dashdash !== -1 ? args.slice(dashdash + 1) : [];
  const argv = harness === "run" ? custom : (HARNESS_COMMANDS[harness] ?? []);
  if (argv.length === 0) {
    return fail(
      harness === "run" ? "usage: mend run -- <command...>" : `unknown harness ${harness}`,
    );
  }

  const project = await findProject(config, explicit);
  const session = await api<SessionDto>(config, "POST", `/projects/${project.id}/sessions`, {
    harness,
    label: null,
    base: null,
  });
  const worktree = worktreePathOf(project.storePath, session.worktree);

  say(`${green("✓")} worktree ${session.worktree} ${dim(`· branch ${session.branch}`)}`);
  say(
    `${green("✓")} base ${dim(session.baseSha.slice(0, 12))} · session ${dim(session.id.slice(0, 8))}`,
  );
  say(`${cobalt("  watch")} · ${config.url}/sessions/${session.id}`);

  // Everything runs SUPERVISED (SDK 0.7.0): a workspace mounts the worktree,
  // a platform PTY runs argv, the record begins. Commands tail the record;
  // interactive harnesses get the full terminal bridge.
  if (harness === "run") {
    return supervisedRun(config, session, argv);
  }
  await withSpinner(
    "provisioning workspace — a first launch builds the harness image (can take minutes)…",
    api<SessionDto>(config, "POST", `/sessions/${session.id}/launch`, { argv }),
  );
  say(`${green("✓ recording")} · workspace mounts the worktree · detach: ${dim("Ctrl+]")}`);
  say("");
  await attachTty(config, session.id, 0n);
  const settled = await api<{ readonly session: SessionDto }>(
    config,
    "GET",
    `/sessions/${session.id}`,
  );
  say("");
  say(`${green("✓")} session ${settled.session.status} · recorded`);
  say(`${cobalt("  review")} · ${config.url}/sessions/${session.id}`);
  process.exit(0);
};

// ─── the terminal bridge: raw stdin/stdout against the platform PTY ─────────

/**
 * Attach this terminal to the session's PTY through the Mend server: SSE
 * output frames → stdout, keystrokes → input POSTs, SIGWINCH → resize.
 * Ctrl+] detaches — the session keeps running and can be reattached from
 * anywhere. Resolves when the session settles or the user detaches.
 */
const attachTty = async (config: CliConfig, sessionId: string, from: bigint) => {
  const headers: Record<string, string> = {};
  if (config.token !== null) headers["authorization"] = `Bearer ${config.token}`;

  const controller = new AbortController();
  const response = await fetch(`${config.url}/api/tty?session=${sessionId}&from=${from}`, {
    headers,
    signal: controller.signal,
  });
  if (!response.ok || response.body === null) {
    return fail(`tty stream unavailable (${response.status}): ${await response.text()}`);
  }

  const postJson = (route: string, body: unknown) =>
    fetch(`${config.url}/api${route}?session=${sessionId}`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => undefined);

  const sendResize = () =>
    postJson("/tty/resize", {
      cols: process.stdout.columns ?? 80,
      rows: process.stdout.rows ?? 24,
    });
  await sendResize();
  process.stdout.on("resize", () => void sendResize());

  const rawTty = process.stdin.isTTY === true;
  if (rawTty) process.stdin.setRawMode(true);
  process.stdin.resume();
  let detached = false;
  const onKeys = (data: Buffer) => {
    if (data.includes(0x1d)) {
      // Ctrl+] — detach, leave the session running.
      detached = true;
      controller.abort();
      return;
    }
    void postJson("/tty/input", { data: data.toString("base64") });
  };
  process.stdin.on("data", onKeys);

  try {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        if (frame.startsWith("event: end")) {
          controller.abort();
          break;
        }
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6))
          .join("");
        if (data === "") continue;
        try {
          const chunk = JSON.parse(data) as { readonly data?: string };
          if (chunk.data !== undefined) {
            process.stdout.write(Buffer.from(chunk.data, "base64"));
          }
        } catch {
          // partial frame — ignore
        }
      }
    }
  } catch {
    // aborted (detach or session end)
  } finally {
    process.stdin.off("data", onKeys);
    if (rawTty) process.stdin.setRawMode(false);
    process.stdin.pause();
  }
  if (detached) {
    say("");
    say(
      `${amber("detached")} — the session keeps running; reattach: mend attach ${sessionId.slice(0, 8)}`,
    );
    process.exit(0);
  }
};

/** Reattach a terminal to a running session (full scrollback replay, then live). */
const attach = async (config: CliConfig, args: ReadonlyArray<string>) => {
  const prefix = args.find((a) => !a.startsWith("--"));
  if (prefix === undefined) return fail("usage: mend attach <session-id-prefix>");
  const sessions = await api<ReadonlyArray<SessionDto>>(config, "GET", "/sessions");
  const match = sessions.find((s) => s.id.startsWith(prefix));
  if (match === undefined) return fail(`no active session matches "${prefix}"`);
  say(
    `${green("✓")} attaching to ${match.harness} · ${dim(match.id.slice(0, 8))} · detach: ${dim("Ctrl+]")}`,
  );
  say("");
  await attachTty(config, match.id, 0n);
  say("");
  say(`${green("✓")} session settled`);
  process.exit(0);
};

// ─── supervised run: platform workspace + PTY + record ──────────────────────

const supervisedRun = async (
  config: CliConfig,
  session: SessionDto,
  argv: ReadonlyArray<string>,
) => {
  const launched = await withSpinner(
    "provisioning workspace — a first launch builds the harness image (can take minutes)…",
    api<SessionDto>(config, "POST", `/sessions/${session.id}/launch`, { argv }),
  );
  say(
    `${green("✓ recording")} · run ${dim(launched.id.slice(0, 8))} · workspace mounts the worktree`,
  );
  say(dim(`  ${argv.join(" ")} — live record:`));
  say("");

  // Tail the record through the server's event stream until the session settles.
  const headers: Record<string, string> = {};
  if (config.token !== null) headers["authorization"] = `Bearer ${config.token}`;
  const response = await fetch(`${config.url}/api/events`, { headers });
  if (response.body === null) return fail("event stream unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let settled: string | null = null;
  while (settled === null) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const data = part
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("");
      if (data === "") continue;
      let event: { readonly type?: string; readonly sessionId?: string; readonly line?: string };
      try {
        event = JSON.parse(data) as typeof event;
      } catch {
        continue;
      }
      if (event.sessionId !== session.id) continue;
      if (event.type === "session-progress" && event.line !== undefined) {
        say(dim(`  ${event.line}`));
      }
      if (event.type === "session") {
        const detail = await api<{ readonly session: SessionDto }>(
          config,
          "GET",
          `/sessions/${session.id}`,
        );
        if (["completed", "failed", "stopped"].includes(detail.session.status)) {
          settled = detail.session.status;
        }
      }
    }
  }
  await reader.cancel().catch(() => undefined);
  say("");
  say(`${green("✓")} session ${settled ?? "settled"} · recorded · checkpoint taken`);
  say(`${cobalt("  review")} · ${config.url}/sessions/${session.id}`);
  process.exit(settled === "failed" ? 1 : 0);
};

// ─── continue: pick up a pending follow-up ──────────────────────────────────

interface FollowUpDto {
  readonly id: string;
  readonly sessionId: string;
  readonly instruction: string;
  readonly status: string;
}

interface ProjectDetailDto {
  readonly project: ProjectDto;
  readonly sessions: ReadonlyArray<SessionDto>;
}

/** How each harness takes an instruction as its opening prompt. */
const CONTINUE_COMMANDS: Record<string, (instruction: string) => ReadonlyArray<string>> = {
  codex: (instruction) => ["codex", instruction],
  claude: (instruction) => ["claude", instruction],
  opencode: (instruction) => ["opencode", "run", instruction],
};

/**
 * The second half of the review loop (plan §7.3): find the session with a
 * pending follow-up, deliver it (which reopens the session), and relaunch the
 * harness in the same worktree with the instruction as its prompt.
 */
const continueSession = async (config: CliConfig, args: ReadonlyArray<string>) => {
  const explicitSession = args.find((a) => !a.startsWith("--")) ?? null;

  let sessionId = explicitSession;
  let followUp: FollowUpDto | null = null;
  if (sessionId !== null) {
    followUp = await api<FollowUpDto | null>(config, "GET", `/sessions/${sessionId}/follow-up`);
    if (followUp === null) return fail(`session ${sessionId} has no pending follow-up`);
  } else {
    // Search the cwd's project, newest sessions first.
    const project = await findProject(config, null);
    const detail = await api<ProjectDetailDto>(config, "GET", `/projects/${project.id}`);
    for (const candidate of detail.sessions) {
      const pending = await api<FollowUpDto | null>(
        config,
        "GET",
        `/sessions/${candidate.id}/follow-up`,
      );
      if (pending !== null) {
        sessionId = candidate.id;
        followUp = pending;
        break;
      }
    }
    if (sessionId === null || followUp === null) {
      return fail("no session with a pending follow-up — send one from the review first");
    }
  }

  const detail = await api<{ readonly session: SessionDto }>(
    config,
    "GET",
    `/sessions/${sessionId}`,
  );
  const session = detail.session;
  const projects = await api<ReadonlyArray<ProjectDto>>(config, "GET", "/projects");
  const project = projects.find((p) => p.id === session.projectId);
  if (project === undefined) return fail(`project ${session.projectId} not found`);
  const worktree = worktreePathOf(project.storePath, session.worktree);

  const build = CONTINUE_COMMANDS[session.harness];
  say(`${green("✓")} follow-up for session ${dim(session.id.slice(0, 8))} · ${session.branch}`);
  say(dim("  instruction:"));
  for (const line of followUp.instruction.split("\n").slice(0, 6)) say(dim(`  │ ${line}`));
  if (followUp.instruction.split("\n").length > 6) say(dim("  │ …"));

  if (build === undefined) {
    say("");
    say(
      `${amber("  cannot relaunch")} ${dim(`— harness "${session.harness}" has no known resume command.`)}`,
    );
    say(dim(`  run it yourself in ${worktree}; the follow-up stays pending.`));
    process.exit(1);
  }

  await api<FollowUpDto>(config, "POST", `/sessions/${session.id}/follow-up/deliver`);
  say(`${green("✓")} delivered · session reopened`);
  say(dim(`  launching ${session.harness} in the worktree…`));
  say("");

  const [command = "", ...rest] = build(followUp.instruction);
  const child = spawn(command, rest, { cwd: worktree, stdio: "inherit" });
  const exitCode: number = await new Promise((resolve) => {
    child.on("exit", (code) => resolve(code ?? 0));
    child.on("error", (error) => {
      process.stderr.write(`mend: could not launch ${command}: ${error.message}\n`);
      resolve(127);
    });
  });

  const settled = await api<SessionDto>(config, "POST", `/sessions/${session.id}/stop`);
  say("");
  say(`${green("✓")} session ${settled.status} · checkpoint taken`);
  say(`${cobalt("  review")} · ${config.url}/sessions/${session.id}`);
  process.exit(exitCode);
};

// ─── status ─────────────────────────────────────────────────────────────────

const status = async (config: CliConfig) => {
  const sessions = await api<ReadonlyArray<SessionDto>>(config, "GET", "/sessions");
  if (sessions.length === 0) {
    say(dim("no active sessions"));
    return;
  }
  for (const session of sessions) {
    say(
      `${session.harness}  ${dim(session.id.slice(0, 8))}  ${session.status}  ${dim(session.branch)}`,
    );
  }
};

// ─── entry ──────────────────────────────────────────────────────────────────

const HELP = `mend — the agent workbench

  mend adopt [source] [--name <name>]   adopt a repository into the store (default: cwd)
  mend codex|claude|opencode            new session worktree + launch the harness in it
  mend run -- <command...>              same, with an arbitrary command
  mend attach <session-id-prefix>       reattach this terminal to a running session
  mend continue [session-id]            resume a session with its pending review follow-up
  mend status                           active sessions

  server: MEND_URL (default http://localhost:3105) · auth: MEND_TOKEN
  config file: ~/.mend/cli.json { "url": ..., "token": ... }
`;

const main = async () => {
  const [command, ...rest] = process.argv.slice(2);
  const config = loadConfig();
  switch (command) {
    case "adopt":
      return adopt(config, rest);
    case "codex":
    case "claude":
    case "opencode":
    case "run":
      return launch(config, command, rest);
    case "attach":
      return attach(config, rest);
    case "continue":
      return continueSession(config, rest);
    case "status":
      return status(config);
    case undefined:
    case "help":
    case "--help":
      say(HELP);
      return;
    default:
      return fail(`unknown command "${command}" — try: mend help`);
  }
};

await main();

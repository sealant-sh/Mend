#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

import { readSyncFiles, scanDotfileCandidates } from "./dotfiles.ts";
import { formatLoadReport, type EnvironmentLoadReportDto } from "./env.ts";
import {
  isComposeFile,
  proposeFromCompose,
  proposeFromPackageJson,
  proposeFromWorkspacePackage,
  renderMendToml,
  workspaceGlobs,
} from "./service-init.ts";
import {
  gitTopLevel,
  HARNESS_COMMANDS,
  LIVE_STATUSES,
  matchProjectByCwd,
  normalizeProjectName,
  parseLaunchArgs,
} from "./shared.ts";

/**
 * The mend CLI (plan §7.2): the terminal-first entry into the workbench.
 *
 *   mend                                  the dashboard: projects + sessions, live
 *   mend adopt [source] [--name <name>]   clone a repo into the store
 *   mend codex|claude|opencode [...]      session worktree + launch the harness there
 *   mend run -- <command...>              same, arbitrary command
 *   mend projects                         adopted projects
 *   mend sessions [--all]                 sessions with their review facts
 *
 * The CLI talks to the Mend server API; the server owns the store, the
 * engine, and the database. Every launch — including `mend continue` — runs
 * supervised: a platform workspace mounts the session's worktree, a platform
 * PTY runs the harness, and the terminal here is one held WebSocket through
 * the Mend server (attachTty). Worktree isolation, checkpoints, the record,
 * the diff, and review all hang off that one path.
 *
 * Commands stay deliberately dependency-light: plain fetch + WebSocket, wire
 * DTOs as plain types (the server validates; the CLI renders). The one
 * exception is the dashboard, which lazy-loads @opentui/core and therefore
 * needs node:ffi (Node 26) — main gates and re-execs with the flag, so
 * everything else keeps running dependency-free on Node >= 22.
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
  readonly gitAuthMode: "ambient" | "mend-key" | "bridge";
}

/** The account's dotfiles: repository knob + store snapshot (see `mend dotfiles`). */
interface DotfilesDto {
  readonly repository: {
    readonly url: string;
    readonly ref: string | null;
    readonly subdirectory: string | null;
    readonly bootstrap: boolean;
  } | null;
  readonly snapshot: {
    readonly sha: string;
    readonly source: string;
    readonly committedAt: string;
    readonly files: ReadonlyArray<{ readonly path: string; readonly bytes: number }>;
  } | null;
}

/** The machine's Mend deploy key — public half only; the server never sends more. */
interface GitKeyDto {
  readonly exists: boolean;
  readonly publicKey: string | null;
  readonly fingerprint: string | null;
}

interface SessionDto {
  readonly id: string;
  readonly projectId: string;
  readonly harness: string;
  readonly label: string | null;
  readonly worktree: string;
  readonly branch: string;
  readonly baseSha: string;
  readonly status: string;
  readonly summary: string | null;
  readonly createdAt: string;
}

/** The DB-cheap review facts the server decorates a project's sessions with. */
interface SessionAnnotationDto {
  readonly sessionId: string;
  readonly openComments: number;
  readonly totalComments: number;
  readonly pendingFollowUp: boolean;
}

// `$XDG_CONFIG_HOME/mend`, default `~/.config/mend`; a pre-XDG `~/.mend` stays authoritative
// when it is the only one present (mirrors @mend/store's resolver — the CLI stays dependency-light).
const mendCliHome = (): string => {
  const xdg = process.env["XDG_CONFIG_HOME"];
  const preferred = path.join(
    xdg === undefined || xdg === "" ? path.join(os.homedir(), ".config") : xdg,
    "mend",
  );
  const legacy = path.join(os.homedir(), ".mend");
  return !fs.existsSync(preferred) && fs.existsSync(legacy) ? legacy : preferred;
};

const CONFIG_PATH = path.join(mendCliHome(), "cli.json");

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

const parseMendUrl = (value: string): URL => {
  try {
    return new URL(value);
  } catch {
    return fail(`"${value}" is not a valid Mend URL`);
  }
};

const paint = (code: string) => (text: string) =>
  process.stdout.isTTY ? `[${code}m${text}[0m` : text;
const dim = paint("2");
const green = paint("32");
const amber = paint("33");
const cobalt = paint("34");
const say = (line: string) => process.stdout.write(`${line}\n`);
const detachKeyEnabled = process.env["MEND_DETACH_KEY"] !== "none";
const detachHint = () => (detachKeyEnabled ? ` · detach: ${dim("Ctrl+]")}` : "");

type HerdrAgent = "codex" | "claude" | "opencode";

const herdrAgentOf = (harness: string): HerdrAgent | null => {
  if (harness === "codex" || harness === "claude" || harness === "opencode") return harness;
  return null;
};

const hintHerdrAttachment = (harness: string): (() => void) => {
  const agent = herdrAgentOf(harness);
  if (process.env["HERDR_ENV"] !== "1" || agent === null) return () => undefined;

  // Herdr deliberately reads HERDR_AGENT from any member of the foreground
  // process group. A pipe-tethered child carries the hint while Mend owns the
  // pane, without claiming lifecycle authority: Herdr's native screen rules
  // still derive working, idle, and blocked from the bridged agent UI.
  const carrier = spawn(
    process.execPath,
    ["-e", "process.stdin.resume();process.stdin.once('end',()=>process.exit(0))"],
    {
      env: { ...process.env, HERDR_AGENT: agent },
      stdio: ["pipe", "ignore", "ignore"],
    },
  );
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    carrier.stdin?.end();
    carrier.kill();
  };
  process.once("exit", stop);
  return () => {
    process.off("exit", stop);
    stop();
  };
};

/** The raw server call — THROWS with a human message; the dashboard renders it. */
const request = async <T>(
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
      // Spread, not `body: null` — fresh oxlint rejects a body key on GETs.
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error(`cannot reach the Mend server at ${config.url} — is it running?`);
  }
  if (response.status === 401) {
    throw new Error(
      config.token === null
        ? `not signed in to ${config.url} — run: mend login`
        : `unauthorized at ${config.url} — the saved token was rejected; run: mend login`,
    );
  }
  const text = await response.text();
  if (!response.ok) {
    let message = `${method} ${route} → ${response.status}`;
    try {
      const parsed = JSON.parse(text) as { readonly message?: string };
      message = parsed.message ?? message;
    } catch {
      // not JSON — keep the status line
    }
    throw new Error(message);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${method} ${route} returned invalid JSON from ${config.url}`);
  }
};

/** The same call for one-shot commands: any failure prints and exits. */
const api = async <T>(
  config: CliConfig,
  method: "GET" | "POST",
  route: string,
  body?: unknown,
): Promise<T> => {
  try {
    return await request<T>(config, method, route, body);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
};

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
  const authFlagIndex = args.indexOf("--auth");
  const positional = args.filter(
    (a, i) =>
      !a.startsWith("--") &&
      (nameFlag === -1 || i !== nameFlag + 1) &&
      (authFlagIndex === -1 || i !== authFlagIndex + 1),
  );
  // Bare `mend adopt` adopts the repo the cwd is inside, not the subdirectory.
  const rawSource = positional[0] ?? gitTopLevel(process.cwd()) ?? ".";
  const source = /^(https?|git|ssh):|^git@/.test(rawSource) ? rawSource : path.resolve(rawSource);
  // Derived defaults are normalized ("Mend" → "mend"); explicit --name is sent as typed.
  const projectName = name ?? normalizeProjectName(path.basename(source, ".git"));

  const auth =
    authFlagIndex !== -1 && args[authFlagIndex + 1] !== undefined
      ? String(args[authFlagIndex + 1])
      : null;
  if (auth !== null && auth !== "ambient" && auth !== "mend-key" && auth !== "bridge") {
    return fail(`--auth takes "ambient", "mend-key", or "bridge", not "${auth}"`);
  }

  const project = await api<ProjectDto>(config, "POST", "/projects", {
    name: projectName,
    source,
    ...(auth === null ? {} : { gitAuthMode: auth }),
  });
  say(`${green("✓")} adopted · ${project.name} · ${dim(project.storePath)}`);
  say(`${dim("  default branch")} ${project.defaultBranch}`);
  // Say which signer did the work — the clone already proved it answers.
  if (project.gitAuthMode === "mend-key") {
    say(`${dim("  git auth")} mend key ${dim("(the machine's deploy key signed this clone)")}`);
  } else if (project.gitAuthMode === "bridge") {
    say(`${dim("  git auth")} bridge ${dim("(signed through the connected `mend keys share`)")}`);
  }
  say(
    `${dim("  sessions start with:")} mend codex ${dim("(from anywhere —")} --project ${project.name}${dim(")")}`,
  );
};

// ─── session launch ─────────────────────────────────────────────────────────

const findProject = async (config: CliConfig, explicit: string | null, adoptCwd = false) => {
  const projects = await api<ReadonlyArray<ProjectDto>>(config, "GET", "/projects");
  if (explicit !== null) {
    const named = projects.find((p) => p.name === explicit);
    if (named === undefined) return fail(`no adopted project named "${explicit}"`);
    return named;
  }
  const cwd = process.cwd();
  const project = matchProjectByCwd(projects, cwd);
  if (project !== undefined) return project;
  if (!adoptCwd) {
    return fail(
      `no adopted project matches ${cwd} — run "mend adopt" here first, or name one with --project`,
    );
  }
  // Launching from an un-adopted repo just adopts it — adoption is cheap and
  // has no ceremony to deserve a separate errand.
  const top = gitTopLevel(cwd);
  if (top === null) {
    return fail(
      `${cwd} is not inside a git repository — mend adopt <source> adopts one explicitly`,
    );
  }
  const adopted = await api<ProjectDto>(config, "POST", "/projects", {
    name: normalizeProjectName(path.basename(top)),
    source: top,
  });
  say(`${green("✓")} adopted · ${adopted.name} · ${dim(adopted.storePath)}`);
  return adopted;
};

const launch = async (config: CliConfig, harness: string, args: ReadonlyArray<string>) => {
  const parsed = parseLaunchArgs(args);
  if (parsed.error !== null) return fail(parsed.error);
  const structured =
    parsed.prompt !== null ||
    parsed.model !== null ||
    parsed.effort !== null ||
    parsed.ask ||
    parsed.fast;
  if (harness === "run" && structured) {
    return fail(
      "mend run takes no prompt or harness flags — usage: mend run [--project p] -- <command...>",
    );
  }
  const argv = harness === "run" ? parsed.custom : (HARNESS_COMMANDS[harness] ?? []);
  if (argv.length === 0) {
    return fail(
      harness === "run" ? "usage: mend run -- <command...>" : `unknown harness ${harness}`,
    );
  }

  const project = await findProject(config, parsed.project, true);
  const session = await api<SessionDto>(config, "POST", `/projects/${project.id}/sessions`, {
    harness,
    label: null,
    base: parsed.base,
  });
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
  // A structured start sends no argv: the server composes the harness flags
  // (one shared mapping) and names the session from the prompt immediately.
  const launchBody = structured
    ? {
        ...(parsed.prompt === null ? {} : { prompt: parsed.prompt }),
        ...(parsed.model === null ? {} : { model: parsed.model }),
        ...(parsed.effort === null ? {} : { effort: parsed.effort }),
        ...(parsed.ask ? { permissionMode: "ask" } : {}),
        ...(parsed.fast ? { speed: "fast" } : {}),
      }
    : { argv };
  await withSpinner(
    "provisioning workspace — a first launch builds the harness image (can take minutes)…",
    api<SessionDto>(config, "POST", `/sessions/${session.id}/launch`, launchBody),
  );
  say(`${green("✓ recording")} · workspace mounts the worktree${detachHint()}`);
  say("");
  await attachOrExit(config, session.id, session.harness);
  exitAfterSessionEnd(config, session.id);
};

// ─── the terminal bridge: raw stdin/stdout against the platform PTY ─────────

/**
 * Attach this terminal to the session's PTY through the Mend server over ONE
 * WebSocket: binary frames are PTY bytes both ways, text frames carry control
 * JSON (resize up, end down). Auth happens once at connect (?token=); after
 * that a keystroke is a frame on an open socket — nothing else on the path.
 * Ctrl+] detaches — the session keeps running and can be reattached from
 * anywhere. Resolves when the session settles or the user detaches; the
 * caller decides what each outcome means (commands exit, the dashboard
 * resumes).
 */
const attachTty = async (
  config: CliConfig,
  sessionId: string,
  harness: string,
  from: bigint,
  processId?: string,
  options?: { readonly readOnly?: boolean },
): Promise<"detached" | "ended" | "unavailable"> => {
  const url = parseMendUrl(`${config.url}/api/tty`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  // Process addressing reaches any PTY in the workspace (a shell); the
  // session form remains the agent's PTY.
  if (processId === undefined) url.searchParams.set("session", sessionId);
  else url.searchParams.set("process", processId);
  url.searchParams.set("from", from.toString());
  if (config.token !== null) url.searchParams.set("token", config.token);

  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  try {
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("could not connect")), { once: true });
    });
  } catch {
    return "unavailable";
  }
  const stopHerdrHint = hintHerdrAttachment(harness);
  let finishAttachment: (() => void) | undefined;
  const finished = new Promise<void>((resolve) => {
    finishAttachment = resolve;
  });
  const onClose = () => finishAttachment?.();
  if (ws.readyState === WebSocket.CLOSED) finishAttachment?.();
  else ws.addEventListener("close", onClose, { once: true });
  const sendResize = () => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        t: "resize",
        cols: process.stdout.columns ?? 80,
        rows: process.stdout.rows ?? 24,
      }),
    );
  };
  const onWinch = () => sendResize();
  const rawTty = process.stdin.isTTY === true;
  let rawModeEnabled = false;
  let detached = false;
  const onTtyFrame = (event: MessageEvent) => {
    if (typeof event.data !== "string") {
      process.stdout.write(Buffer.from(event.data));
      return;
    }
    try {
      const frame: unknown = JSON.parse(event.data);
      if (typeof frame !== "object" || frame === null || !("t" in frame) || frame.t !== "end") {
        return;
      }
      // Session lifecycle is authoritative. Start detaching immediately instead
      // of holding the user's terminal for the later close handshake and Mend's
      // settle/checkpoint/harvest work.
      ws.close();
      finishAttachment?.();
    } catch {
      // Unknown text control frame — ignore.
    }
  };
  const onKeys = (data: Buffer) => {
    if (detachKeyEnabled && data.includes(0x1d)) {
      // Ctrl+] — detach, leave the session running.
      detached = true;
      ws.close();
      return;
    }
    if (ws.readyState !== WebSocket.OPEN) return;
    // Copy into a plain ArrayBuffer (WebSocket.send rejects pooled Buffer views).
    ws.send(new Uint8Array(data).buffer);
  };
  try {
    sendResize();
    process.stdout.on("resize", onWinch);
    // Read-only (logs): never forward stdin — Ctrl+C exits the CLI, the
    // socket drops, and the process inside keeps running untouched.
    if (options?.readOnly !== true) {
      if (rawTty) {
        process.stdin.setRawMode(true);
        rawModeEnabled = true;
      }
      process.stdin.resume();
      process.stdin.on("data", onKeys);
    }
    ws.addEventListener("message", onTtyFrame);
    await finished;
    return detached ? "detached" : "ended";
  } finally {
    process.stdin.off("data", onKeys);
    process.stdout.off("resize", onWinch);
    ws.removeEventListener("message", onTtyFrame);
    ws.removeEventListener("close", onClose);
    if (rawModeEnabled) process.stdin.setRawMode(false);
    process.stdin.pause();
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    stopHerdrHint();
  }
};

/** How every one-shot command handles an attach outcome: detach says so, settle returns. */
const finishAttach = (
  config: CliConfig,
  sessionId: string,
  outcome: "detached" | "ended" | "unavailable",
) => {
  if (outcome === "unavailable") {
    return fail(`tty attach unavailable: could not connect to ${config.url}`);
  }
  if (outcome === "detached") {
    say("");
    say(
      `${amber("detached")} — the session keeps running; reattach: mend attach ${sessionId.slice(0, 8)}`,
    );
    process.exit(0);
  }
};

const attachOrExit = async (config: CliConfig, sessionId: string, harness: string) =>
  finishAttach(config, sessionId, await attachTty(config, sessionId, harness, 0n));

/** Return terminal control as soon as the terminal reports the observed end. */
const exitAfterSessionEnd = (config: CliConfig, sessionId: string): never => {
  say("");
  say(`${green("✓")} session ended`);
  say(`${cobalt("  review")} · ${config.url}/sessions/${sessionId}`);
  process.exit(0);
};

/** Reattach a terminal to a running session (full scrollback replay, then live). */
const attach = async (config: CliConfig, args: ReadonlyArray<string>) => {
  const prefix = args.find((a) => !a.startsWith("--"));
  if (prefix === undefined) return fail("usage: mend attach <session-id-prefix>");
  const sessions = await api<ReadonlyArray<SessionDto>>(config, "GET", "/sessions");
  const match = sessions.find((s) => s.id.startsWith(prefix));
  if (match === undefined) return fail(`no active session matches "${prefix}"`);
  say(`${green("✓")} attaching to ${match.harness} · ${dim(match.id.slice(0, 8))}${detachHint()}`);
  say("");
  await attachOrExit(config, match.id, match.harness);
  exitAfterSessionEnd(config, match.id);
};

// ─── shell: the second pane — a real shell in the session's workspace ───────

interface SessionProcessDto {
  readonly id: string;
  readonly sessionId: string;
  readonly kind: string;
  readonly label: string | null;
  readonly status: string;
}

/** Compact picker: numbered live sessions, one keystroke of typing. */
const pickSessionInteractively = async (
  rows: ReadonlyArray<{ readonly session: SessionDto; readonly projectName: string }>,
): Promise<SessionDto> => {
  say(dim("more than one live session — pick one:"));
  rows.forEach((row, index) => {
    say(
      `  ${index + 1}. ${row.session.harness.padEnd(8)} ${dim(row.session.id.slice(0, 8))}  ${row.projectName}  ${dim(row.session.branch)}`,
    );
  });
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("  session #: ");
  rl.close();
  const chosen = rows[Number(answer.trim()) - 1];
  if (chosen === undefined) return fail(`"${answer.trim()}" is not one of the choices`);
  return chosen.session;
};

/**
 * The resolution order (docs/SESSION-SERVICES.md): an explicit id wins, then
 * the cwd's project narrows, one candidate is taken, several go to the
 * picker, and a non-interactive caller never gets a silent guess.
 */
const resolveLiveSession = async (
  config: CliConfig,
  prefix: string | undefined,
): Promise<SessionDto> => {
  const sessions = await api<ReadonlyArray<SessionDto>>(config, "GET", "/sessions?retained=1");
  if (prefix !== undefined) {
    const matches = sessions.filter((s) => s.id.startsWith(prefix));
    if (matches.length === 0) return fail(`no live or retained session matches "${prefix}"`);
    const exact = matches[0];
    if (matches.length > 1 || exact === undefined) {
      return fail(`session prefix "${prefix}" is ambiguous — use more of the id`);
    }
    return exact;
  }
  const projects = await api<ReadonlyArray<ProjectDto>>(config, "GET", "/projects");
  const project = matchProjectByCwd(projects, process.cwd());
  const candidates =
    project === undefined ? sessions : sessions.filter((s) => s.projectId === project.id);
  const only = candidates[0];
  if (only === undefined) {
    return fail("no live or retained session — start one with mend codex|claude|opencode");
  }
  if (candidates.length === 1) return only;
  if (process.stdin.isTTY !== true) {
    return fail("several live sessions — name one: mend shell <session-id-prefix>");
  }
  const nameById = new Map(projects.map((p) => [p.id, p.name]));
  return pickSessionInteractively(
    candidates.map((session) => ({
      session,
      projectName: nameById.get(session.projectId) ?? session.projectId.slice(0, 8),
    })),
  );
};

/**
 * A real interactive shell in the session's CURRENT workspace — same
 * /workspace/repo the agent is editing, same dependencies, same network. Not
 * a shell in the host checkout. The shell holds a workspace lease, so the
 * container survives the agent settling while the shell lives.
 */
const shellCommand = async (config: CliConfig, args: ReadonlyArray<string>) => {
  const prefix = args.find((a) => !a.startsWith("--"));
  const session = await resolveLiveSession(config, prefix);
  say(
    `${green("✓")} shell in ${session.harness} session ${dim(session.id.slice(0, 8))} · ${dim(session.branch)}${detachHint()}`,
  );
  const shellProcess = await withSpinner(
    "opening a shell in the session workspace…",
    api<SessionProcessDto>(config, "POST", `/sessions/${session.id}/shell`),
  );
  say("");
  const outcome = await attachTty(config, session.id, "shell", 0n, shellProcess.id);
  if (outcome === "unavailable") {
    return fail(`tty attach unavailable: could not connect to ${config.url}`);
  }
  say("");
  if (outcome === "detached") {
    say(`${amber("detached")} — the shell keeps running and holds the workspace open`);
    process.exit(0);
  }
  say(`${green("✓")} shell ended`);
  process.exit(0);
};

// ─── services: reachable ports, everywhere the session is ───────────────────

interface ServiceRecipeDto {
  readonly name: string;
  readonly command: string | null;
  readonly port: number;
  readonly protocol: "tcp" | "udp";
  readonly browserScheme: "http" | "https" | null;
  readonly shadowedBy: "file" | "project" | null;
}

interface ServiceEndpointDto {
  readonly authority: string;
  readonly hostPort: number;
  readonly scope: "loopback" | "private";
  readonly browserUrl: string | null;
  readonly mendAuthentication: "none";
}

interface ServiceViewDto {
  readonly service: {
    readonly id: string;
    readonly sessionId: string;
    readonly name: string;
    readonly workspacePort: number;
    readonly transport: "tcp" | "udp";
    readonly currentAttemptId: string | null;
  };
  readonly attempts: ReadonlyArray<{
    readonly id: string;
    readonly argv: ReadonlyArray<string>;
    readonly status: string;
    readonly exitedAt: string | null;
    readonly sealantSessionId: string | null;
  }>;
  readonly currentForward: {
    readonly id: string;
    readonly hostPort: number | null;
    readonly state: "binding" | "bound" | "closed" | "failed";
  } | null;
  readonly latestObservation: {
    readonly forwardId: string;
    readonly state: "reachable" | "unreachable";
  } | null;
  readonly workspaceExpiresAt: string | null;
  readonly workspaceTtlRenewedAt: string | null;
  readonly workspaceTtlRenewalFailedAt: string | null;
  readonly workspaceTtlRenewalError: string | null;
  readonly endpoints: ReadonlyArray<ServiceEndpointDto>;
}

interface ProcessLogPageDto {
  readonly processId: string;
  readonly sealantSessionId: string;
  readonly sealantRunId: string | null;
  readonly requestedFrom: string;
  readonly firstSequence: string | null;
  readonly lastSequence: string | null;
  readonly nextFrom: string;
  readonly status: "exited" | "failed" | "running" | "starting";
  readonly chunks: ReadonlyArray<{
    readonly sequence: string;
    readonly dataBase64: string;
  }>;
  readonly telemetryLoss: "unknown";
  readonly telemetryNote: string;
}

interface ServiceDto {
  readonly id: string;
  readonly processId: string | null;
  readonly sessionId: string;
  readonly label: string;
  readonly status: string;
  readonly workspacePort: number;
  readonly hostPort: number | null;
  readonly authority: string | null;
  readonly browserUrl: string | null;
  readonly exposureScope: "loopback" | "private" | null;
  readonly mendAuthentication: "none" | null;
  readonly protocol: "tcp" | "udp";
  readonly sealantSessionId: string | null;
  readonly attemptExitedAt: string | null;
  readonly argv: ReadonlyArray<string>;
  readonly workspaceExpiresAt: string | null;
  readonly workspaceTtlRenewedAt: string | null;
  readonly workspaceTtlRenewalFailedAt: string | null;
  readonly workspaceTtlRenewalError: string | null;
}

const flattenService = (view: ServiceViewDto): ServiceDto => {
  const attempt =
    view.service.currentAttemptId === null
      ? null
      : (view.attempts.find((candidate) => candidate.id === view.service.currentAttemptId) ?? null);
  const observation =
    view.currentForward !== null && view.latestObservation?.forwardId === view.currentForward.id
      ? view.latestObservation
      : null;
  const endpoint =
    view.endpoints.find((candidate) => candidate.scope === "private") ?? view.endpoints[0] ?? null;
  const browserUrl =
    view.endpoints.find((candidate) => candidate.browserUrl !== null)?.browserUrl ?? null;
  return {
    id: view.service.id,
    processId: attempt?.id ?? null,
    sessionId: view.service.sessionId,
    label: view.service.name,
    status: observation?.state ?? view.currentForward?.state ?? attempt?.status ?? "stopped",
    workspacePort: view.service.workspacePort,
    hostPort: endpoint?.hostPort ?? null,
    authority: endpoint?.authority ?? null,
    browserUrl,
    exposureScope: endpoint?.scope ?? null,
    mendAuthentication: endpoint?.mendAuthentication ?? null,
    protocol: view.service.transport,
    sealantSessionId: attempt?.sealantSessionId ?? null,
    attemptExitedAt: attempt?.exitedAt ?? null,
    argv: attempt?.argv ?? [],
    workspaceExpiresAt: view.workspaceExpiresAt,
    workspaceTtlRenewedAt: view.workspaceTtlRenewedAt,
    workspaceTtlRenewalFailedAt: view.workspaceTtlRenewalFailedAt,
    workspaceTtlRenewalError: view.workspaceTtlRenewalError,
  };
};

const fetchServiceViews = (config: CliConfig, all = false) =>
  api<ReadonlyArray<ServiceViewDto>>(config, "GET", `/services${all ? "?all=1" : ""}`);

const fetchServices = async (config: CliConfig, all = false): Promise<ReadonlyArray<ServiceDto>> =>
  (await fetchServiceViews(config, all)).map(flattenService);

const mutateService = async (
  config: CliConfig,
  method: "POST",
  endpointPath: string,
  body?: unknown,
): Promise<ServiceDto> =>
  flattenService(await api<ServiceViewDto>(config, method, endpointPath, body));

const serviceUrl = (service: ServiceDto): string =>
  service.browserUrl ??
  (service.authority === null
    ? "unbound"
    : `${service.authority}${service.protocol === "udp" ? " (udp)" : ""}`);

const serviceExposure = (service: ServiceDto): string => {
  if (service.exposureScope === null) return "";
  if (service.exposureScope === "private") {
    return "No Mend sign-in protects this port. Anyone who can reach this private address can connect.";
  }
  return `Loopback only · Mend auth: ${service.mendAuthentication ?? "unknown"}`;
};

const printWorkspaceTtlFailure = (service: ServiceDto): void => {
  if (service.workspaceTtlRenewalError === null) return;
  say(amber(`  workspace TTL renewal failed · ${service.workspaceTtlRenewalError}`));
  say(
    dim(
      `  last renewed ${service.workspaceTtlRenewedAt ?? "unknown"} · known expiry ${service.workspaceExpiresAt ?? "unknown"} · failed ${service.workspaceTtlRenewalFailedAt ?? "unknown"}`,
    ),
  );
};

const printServiceEndpoint = (service: ServiceDto): void => {
  const exposure = serviceExposure(service);
  say(`  ${cobalt(serviceUrl(service))}${exposure === "" ? "" : `  ${dim(exposure)}`}`);
  printWorkspaceTtlFailure(service);
};

const printService = (service: ServiceDto) => {
  const status = service.status === "reachable" ? green(service.status) : amber(service.status);
  const exposure = serviceExposure(service);
  say(
    `${(service.label ?? service.id.slice(0, 8)).padEnd(12)}  ${dim(`:${service.workspacePort ?? "?"}${service.protocol === "udp" ? "/udp" : ""} →`)} ${serviceUrl(service)}  ${status}  ${dim(service.id.slice(0, 8))}${exposure === "" ? "" : `  ${dim(exposure)}`}`,
  );
  printWorkspaceTtlFailure(service);
};

/**
 * Adopt an already-listening workspace port as a Service: Mend binds a host
 * port on its private interfaces and pumps every connection into the
 * session's workspace. No supervision — reachability is the observation.
 */
const serviceAdd = async (config: CliConfig, args: ReadonlyArray<string>) => {
  const nameFlag = args.indexOf("--name");
  const name =
    nameFlag !== -1 && args[nameFlag + 1] !== undefined ? String(args[nameFlag + 1]) : null;
  const protocol = args.includes("--udp") ? ("udp" as const) : ("tcp" as const);
  const http = args.includes("--http");
  const https = args.includes("--https");
  if (http && https) return fail("Choose either --http or --https, not both.");
  const browserScheme = https ? ("https" as const) : http ? ("http" as const) : null;
  if (protocol === "udp" && browserScheme !== null) {
    return fail("UDP Services cannot use --http or --https");
  }
  const positional = args.filter(
    (a, i) => !a.startsWith("--") && (nameFlag === -1 || i !== nameFlag + 1),
  );
  const portRaw = positional.find((a) => /^\d+$/.test(a));
  if (portRaw === undefined) {
    return fail("usage: mend service add [session] <port> [--name <n>] [--udp] [--http|--https]");
  }
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return fail(`"${portRaw}" is not a port`);
  }
  const prefix = positional.find((a) => a !== portRaw);
  const session = await resolveLiveSession(config, prefix);

  const service = await mutateService(config, "POST", `/sessions/${session.id}/services`, {
    port,
    name,
    protocol,
    browserScheme,
  });
  say(`${green("✓")} Service ${service.label ?? ""} · ${service.status}`);
  printServiceEndpoint(service);
  if (protocol === "udp") {
    say(dim(`  udp — a reply is the only reachability signal; silence just relays`));
  } else if (service.status !== "reachable") {
    say(dim(`  nothing answered on :${port} yet — the URL goes live when something listens`));
  }
};

const serviceList = async (config: CliConfig) => {
  const services = await fetchServices(config);
  if (services.length === 0) {
    say(dim("no live services — mend service add <port> adopts a listening one"));
    return;
  }
  for (const service of services) printService(service);
};

const serviceStop = async (config: CliConfig, args: ReadonlyArray<string>) => {
  const needle = args.find((a) => !a.startsWith("--"));
  if (needle === undefined) return fail("usage: mend service stop <name-or-id-prefix>");
  const services = await fetchServices(config);
  const matches = services.filter(
    (service) => service.label === needle || service.id.startsWith(needle),
  );
  if (matches.length === 0) return fail(`no live service matches "${needle}"`);
  const match = matches[0];
  if (matches.length > 1 || match === undefined) {
    return fail(`"${needle}" is ambiguous — use more of the id`);
  }
  const stoppedService = await mutateService(config, "POST", `/services/${match.id}/stop`);
  say(`${green("✓")} stopped · ${stoppedService.label ?? stoppedService.id.slice(0, 8)}`);
};

const findLiveService = async (config: CliConfig, needle: string): Promise<ServiceDto> => {
  const services = await fetchServices(config);
  const matches = services.filter(
    (service) => service.label === needle || service.id.startsWith(needle),
  );
  if (matches.length === 0) return fail(`no live service matches "${needle}"`);
  const match = matches[0];
  if (matches.length > 1 || match === undefined) {
    return fail(`"${needle}" is ambiguous — use more of the id`);
  }
  return match;
};

/**
 * Start and supervise a Service: the command runs as its own PTY process in
 * the session's workspace (own record = its logs), Mend waits for the
 * declared port to answer, then exposes it like any Service. The command
 * never occupies the agent's terminal or a tool call.
 */
const serviceRun = async (config: CliConfig, args: ReadonlyArray<string>) => {
  const dashdash = args.indexOf("--");
  const usage =
    "usage: mend service run [session] --port <port> [--name <n>] [--udp] [--http|--https] -- <command...>\n" +
    "       mend service run [session] <name>          (a declared recipe)";
  // No explicit command = a DECLARED Service: resolve the name against the
  // session worktree's mend.toml and start (or adopt) its recipe.
  if (dashdash === -1) {
    const positionals = args.filter((a) => !a.startsWith("--"));
    const name = positionals.at(-1);
    if (name === undefined) return fail(usage);
    const prefix = positionals.length > 1 ? positionals[0] : undefined;
    const session = await resolveLiveSession(config, prefix);
    const recipes = await api<ReadonlyArray<ServiceRecipeDto>>(
      config,
      "GET",
      `/sessions/${session.id}/recipes`,
    );
    const recipe = recipes.find((entry) => entry.name === name);
    if (recipe === undefined) {
      const known = recipes.map((entry) => entry.name).join(", ");
      return fail(
        recipes.length === 0
          ? `no mend.toml recipes in this worktree — declare [service.${name}] first`
          : `no recipe named "${name}" — declared: ${known}`,
      );
    }
    const service = await withSpinner(
      recipe.command === null
        ? `adopting ${recipe.name} on :${recipe.port}…`
        : recipe.protocol === "udp"
          ? `starting ${recipe.name} (udp :${recipe.port})…`
          : `starting ${recipe.name} — waiting for :${recipe.port} to answer…`,
      mutateService(config, "POST", `/sessions/${session.id}/services/recipe`, {
        name: recipe.name,
      }),
    );
    say(`${green("✓")} Service ${service.label ?? ""} · ${service.status}`);
    printServiceEndpoint(service);
    say(dim(`  logs: mend service logs ${service.label ?? service.id.slice(0, 8)}`));
    return;
  }
  const argv = args.slice(dashdash + 1);
  if (argv.length === 0) return fail(usage);
  const head = args.slice(0, dashdash);
  const portFlag = head.indexOf("--port");
  const port = portFlag === -1 ? Number.NaN : Number(head[portFlag + 1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return fail(usage);
  const nameFlag = head.indexOf("--name");
  const name =
    nameFlag !== -1 && head[nameFlag + 1] !== undefined ? String(head[nameFlag + 1]) : null;
  const protocol = head.includes("--udp") ? ("udp" as const) : ("tcp" as const);
  const http = head.includes("--http");
  const https = head.includes("--https");
  if (http && https) return fail(usage);
  const browserScheme = https ? ("https" as const) : http ? ("http" as const) : null;
  if (protocol === "udp" && browserScheme !== null) return fail(usage);
  const prefix = head.find(
    (a, i) => !a.startsWith("--") && i !== portFlag + 1 && i !== nameFlag + 1,
  );
  const session = await resolveLiveSession(config, prefix);

  const service = await withSpinner(
    protocol === "udp"
      ? `starting ${name ?? argv[0]} (udp :${port})…`
      : `starting ${name ?? argv[0]} — waiting for :${port} to answer…`,
    mutateService(config, "POST", `/sessions/${session.id}/services/run`, {
      argv,
      port,
      name,
      protocol,
      browserScheme,
    }),
  );
  say(`${green("✓")} Service ${service.label ?? ""} · ${service.status}`);
  printServiceEndpoint(service);
  say(dim(`  logs: mend service logs ${service.label ?? service.id.slice(0, 8)}`));
};

/** Read sequence-addressed PTY output without attaching an input-capable terminal. */
const serviceLogs = async (config: CliConfig, args: ReadonlyArray<string>) => {
  const fromFlag = args.indexOf("--from");
  const from = fromFlag === -1 ? "0" : args[fromFlag + 1];
  const needle = args.find(
    (argument, index) => !argument.startsWith("--") && index !== fromFlag + 1,
  );
  if (needle === undefined || from === undefined || !/^(0|[1-9]\d*)$/.test(from)) {
    return fail("usage: mend service logs <name-or-id-prefix> [--from <decimal-sequence>]");
  }
  const everything = await fetchServiceViews(config, true);
  const matches = everything.filter(
    (view) =>
      view.service.name === needle ||
      view.service.id.startsWith(needle) ||
      view.attempts.some((attempt) => attempt.id.startsWith(needle)),
  );
  if (matches.length === 0) return fail(`no service matches "${needle}"`);
  const view =
    matches.find((candidate) => {
      const current =
        candidate.service.currentAttemptId === null
          ? null
          : candidate.attempts.find((attempt) => attempt.id === candidate.service.currentAttemptId);
      return current !== null && current !== undefined && current.exitedAt === null;
    }) ?? matches[0];
  if (view === undefined) return fail(`no service matches "${needle}"`);
  const currentAttempt =
    view.service.currentAttemptId === null
      ? null
      : (view.attempts.find((candidate) => candidate.id === view.service.currentAttemptId) ?? null);
  const attempt =
    view.attempts.find((candidate) => candidate.id.startsWith(needle)) ??
    currentAttempt ??
    view.attempts.findLast((candidate) => candidate.sealantSessionId !== null) ??
    null;
  if (attempt?.sealantSessionId === null || attempt === null) {
    return fail(
      `"${needle}" is an adopted port — no process of Mend's, no logs. mend service run supervises.`,
    );
  }
  const label = view.service.name;
  say(
    dim(
      attempt.exitedAt === null
        ? `following ${label} from sequence ${from} — Ctrl+C detaches, the Service keeps running`
        : `${label} · ${attempt.status} — recorded output from sequence ${from}`,
    ),
  );
  say("");

  let cursor = from;
  let telemetryReported = false;
  for (;;) {
    const page = await api<ProcessLogPageDto>(
      config,
      "GET",
      `/processes/${attempt.id}/logs?from=${encodeURIComponent(cursor)}&limit=256`,
    );
    if (!telemetryReported) {
      say(dim(`telemetry loss: ${page.telemetryLoss} · ${page.telemetryNote}`));
      telemetryReported = true;
    }
    for (const chunk of page.chunks) {
      process.stdout.write(Buffer.from(chunk.dataBase64, "base64"));
    }
    const advanced = page.nextFrom !== cursor;
    cursor = page.nextFrom;
    const ended = page.status === "exited" || page.status === "failed";
    if (ended && !advanced) break;
    if (!advanced) await new Promise((resolve) => setTimeout(resolve, 250));
  }

  say("");
  say(dim(`stream ended · next sequence ${cursor}`));
};

const serviceRestart = async (config: CliConfig, args: ReadonlyArray<string>) => {
  const needle = args.find((a) => !a.startsWith("--"));
  if (needle === undefined) return fail("usage: mend service restart <name-or-id-prefix>");
  const service = await findLiveService(config, needle);
  const restarted = await withSpinner(
    `restarting ${service.label ?? service.id.slice(0, 8)}…`,
    mutateService(config, "POST", `/services/${service.id}/restart`),
  );
  say(`${green("✓")} restarted · ${restarted.status}`);
  printServiceEndpoint(restarted);
};

/**
 * Scaffold mend.toml from the project's own manifests. Static suggestion,
 * not detection: package.json scripts and compose port mappings become
 * recipe proposals the user confirms and commits. Nothing runs.
 */
const serviceInit = async (args: ReadonlyArray<string>) => {
  const root = gitTopLevel(process.cwd()) ?? process.cwd();
  const target = path.join(root, "mend.toml");
  if (fs.existsSync(target)) {
    return fail(`${target} already exists — edit it directly (init never merges)`);
  }
  const rootFiles = fs.readdirSync(root);
  const proposals: Array<ReturnType<typeof proposeFromCompose>[number]> = [];
  const readRoot = (name: string) => fs.readFileSync(path.join(root, name), "utf8");
  if (rootFiles.includes("package.json")) {
    proposals.push(...proposeFromPackageJson(readRoot("package.json"), rootFiles));
  }
  // Monorepo sweep: every workspace package, named after its folder.
  const globs = workspaceGlobs(
    rootFiles.includes("pnpm-workspace.yaml") ? readRoot("pnpm-workspace.yaml") : null,
    rootFiles.includes("package.json") ? readRoot("package.json") : null,
  );
  for (const glob of globs) {
    const parent = glob.replace(/\/?\*+$/, "");
    const dirs = glob.endsWith("*")
      ? fs.existsSync(path.join(root, parent))
        ? fs.readdirSync(path.join(root, parent)).map((dir) => path.join(parent, dir))
        : []
      : [glob];
    for (const dir of dirs) {
      const manifest = path.join(root, dir, "package.json");
      if (!fs.existsSync(manifest)) continue;
      for (const proposal of proposeFromWorkspacePackage(
        path.basename(dir),
        fs.readFileSync(manifest, "utf8"),
        rootFiles,
      )) {
        if (!proposals.some((existing) => existing.name === proposal.name)) {
          proposals.push(proposal);
        }
      }
    }
  }
  // Every compose flavor in the root, aggregated; non-default files need -f.
  for (const composeName of rootFiles.filter(isComposeFile).toSorted()) {
    const isDefault = composeName === "compose.yaml" || composeName === "docker-compose.yml";
    for (const proposal of proposeFromCompose(readRoot(composeName))) {
      if (!proposals.some((existing) => existing.name === proposal.name)) {
        proposals.push({
          ...proposal,
          command: isDefault
            ? proposal.command
            : proposal.command.replace("docker compose ", `docker compose -f ${composeName} `),
          source: `${composeName}: ${proposal.source}`,
        });
      }
    }
  }
  if (proposals.length === 0) {
    return fail(
      "nothing to propose — no server-ish package.json script with a nameable port, no compose ports",
    );
  }
  const toml = renderMendToml(proposals);
  say(dim(`proposed ${target}:`));
  say("");
  process.stdout.write(toml);
  say("");
  if (!args.includes("--yes")) {
    if (process.stdin.isTTY !== true) {
      return fail("non-interactive — pass --yes to write the file");
    }
    const readline = await import("node:readline/promises");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("write it? [y/N] ");
    rl.close();
    if (answer.trim().toLowerCase() !== "y") {
      say(dim("nothing written"));
      return;
    }
  }
  fs.writeFileSync(target, toml);
  say(`${green("✓")} wrote ${target} — commit it, then: mend service run ${proposals[0]?.name}`);
};

const serviceCommand = async (config: CliConfig, args: ReadonlyArray<string>) => {
  const [verb, ...rest] = args;
  switch (verb) {
    case "run":
      return serviceRun(config, rest);
    case "add":
      return serviceAdd(config, rest);
    case "init":
      return serviceInit(rest);
    case "list":
    case undefined:
      return serviceList(config);
    case "logs":
      return serviceLogs(config, rest);
    case "restart":
      return serviceRestart(config, rest);
    case "stop":
      return serviceStop(config, rest);
    default:
      // Sugar: `mend service mysql` reads as `mend service run mysql` — a
      // bare word that isn't a verb is a recipe name. A miss still explains
      // itself (declared recipes are listed in the failure).
      return serviceRun(config, [verb, ...rest]);
  }
};

// ─── login: obtain and save the bearer token ────────────────────────────────

const takeFlagValue = (args: ReadonlyArray<string>, flag: string): string | null => {
  const at = args.indexOf(flag);
  return at !== -1 && args[at + 1] !== undefined ? String(args[at + 1]) : null;
};

/**
 * Read a password: raw-mode without echo on a TTY; on a pipe, one line through the SAME readline
 * that read the email (a second reader would find the buffered pipe already drained).
 */
const readSecretLine = async (
  prompt: string,
  rl: { readonly question: (query: string) => Promise<string> },
): Promise<string> => {
  if (process.stdin.isTTY !== true) {
    return (await rl.question(prompt)).trim();
  }
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let buffer = "";
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(buffer);
          return;
        }
        if (char === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") {
          buffer = buffer.slice(0, -1);
          continue;
        }
        buffer += char;
      }
    };
    stdin.on("data", onData);
  });
};

const saveCliConfig = (next: CliConfig) => {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    CONFIG_PATH,
    `${JSON.stringify({ url: next.url, token: next.token }, null, 2)}\n`,
    { mode: 0o600 },
  );
  fs.chmodSync(CONFIG_PATH, 0o600);
};

/**
 * `mend login [--url <server>] [--email <address>]`: sign in with email + password against the
 * server's auth endpoint (the bearer plugin answers with a `set-auth-token` header) and save the
 * token 0600 in the CLI config. Nothing else asks for a password again.
 */
const login = async (config: CliConfig, args: ReadonlyArray<string>) => {
  const url = takeFlagValue(args, "--url") ?? process.env["MEND_URL"] ?? config.url;
  const emailFlag = takeFlagValue(args, "--email");
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const email = emailFlag ?? (await rl.question(`email for ${url}: `)).trim();
  if (email === "") {
    rl.close();
    return fail("an email is required");
  }
  const password = await readSecretLine("password: ", rl);
  rl.close();
  if (password === "") return fail("a password is required");

  let response: Response;
  try {
    response = await fetch(`${url}/api/auth/sign-in/email`, {
      method: "POST",
      // better-auth's CSRF check rejects the `Origin: null` a non-browser fetch sends; the
      // server's own URL is always a trusted origin, so present that.
      headers: { "content-type": "application/json", origin: url },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return fail(`cannot reach the Mend server at ${url} — is it running?`);
  }
  if (response.status === 401 || response.status === 403 || response.status === 400) {
    return fail(`sign-in refused for ${email} at ${url}`);
  }
  if (!response.ok) return fail(`sign-in failed: ${url} responded ${response.status}`);
  const token = response.headers.get("set-auth-token");
  if (token === null || token === "") {
    return fail("the server signed you in but returned no bearer token (bearer plugin missing?)");
  }
  saveCliConfig({ ...config, url, token });
  say(`${green("✓")} signed in as ${email} · ${dim(`token saved to ${CONFIG_PATH}`)}`);
};

const logout = (config: CliConfig) => {
  if (!fs.existsSync(CONFIG_PATH)) {
    say(dim("nothing saved — already signed out"));
    return;
  }
  saveCliConfig({ ...config, token: null });
  say(`${green("✓")} signed out · ${dim(`token removed from ${CONFIG_PATH}`)}`);
};

// ─── keys: the machine's Mend deploy key (docs/GIT-ACCESS.md) ───────────────

/** Print the public key with the one instruction that makes it useful. */
const printGitKey = (key: GitKeyDto) => {
  if (key.publicKey === null) return;
  say(key.publicKey);
  if (key.fingerprint !== null) say(dim(`  ${key.fingerprint}`));
  say(dim("  add this as a deploy key on your git host (GitHub/GitLab/Gitea: repo"));
  say(dim("  settings → deploy keys; grant write access if sessions should push),"));
  say(dim("  then adopt with: mend adopt <ssh-url> --auth mend-key"));
};

const keysShow = async (config: CliConfig) => {
  const key = await api<GitKeyDto>(config, "GET", "/keys/git");
  if (!key.exists) {
    say(
      `no Mend key yet ${dim("— mend keys init generates one (ed25519, stays on the server host)")}`,
    );
    return;
  }
  printGitKey(key);
};

const keysInit = async (config: CliConfig) => {
  const key = await api<GitKeyDto>(config, "POST", "/keys/git");
  say(`${green("✓")} Mend key ready ${dim("(private half stays on the server host)")}`);
  printGitKey(key);
};

/**
 * The ssh-agent bridge, client half (docs/GIT-ACCESS.md decision 2): relay
 * the LOCAL ssh-agent to the Mend server over one standing WebSocket, so
 * bridge-mode git ops sign with a key that never leaves this machine — a
 * hardware key blinks here, not on the server. Agent-protocol messages are
 * relayed verbatim (length-prefixed frames, base64 over JSON); the only
 * inspection is each message's type byte, to say what is being asked.
 */
const keysShare = async (config: CliConfig) => {
  const agentSock = process.env["SSH_AUTH_SOCK"];
  if (agentSock === undefined || agentSock === "") {
    return fail("SSH_AUTH_SOCK is not set — start (or plug in) your ssh-agent first");
  }
  const url = parseMendUrl(`${config.url}/api/keys/bridge/ws`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("host", os.hostname());
  if (config.token !== null) url.searchParams.set("token", config.token);

  /**
   * One complete agent exchange against the local agent: fresh connection,
   * write the framed request verbatim, read one framed response. A hardware
   * key blocks here until the touch — hence the generous timeout.
   */
  const askLocalAgent = (payload: Buffer): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      const connection = net.connect(agentSock, () => {
        connection.write(payload);
      });
      const timer = setTimeout(() => {
        connection.destroy();
        reject(new Error("the agent did not answer within 60s — touch missed?"));
      }, 60_000);
      let pending: Buffer = Buffer.alloc(0);
      connection.on("data", (chunk: Buffer) => {
        pending = Buffer.concat([pending, chunk]);
        if (pending.length >= 4 && pending.length >= 4 + pending.readUInt32BE(0)) {
          clearTimeout(timer);
          connection.end();
          resolve(pending.subarray(0, 4 + pending.readUInt32BE(0)));
        }
      });
      connection.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

  // Strictly one request at a time, in arrival order — the agent protocol is
  // request/response and a hardware key cannot answer two touches at once.
  let chain: Promise<unknown> = Promise.resolve();
  const SSH_AGENTC_SIGN_REQUEST = 13;
  const SSH_AGENTC_REQUEST_IDENTITIES = 11;

  let attempt = 0;
  for (;;) {
    const ws = new WebSocket(url);
    const closed = new Promise<void>((resolve) => {
      ws.addEventListener("close", () => resolve(), { once: true });
    });
    const opened = await new Promise<boolean>((resolve) => {
      ws.addEventListener("open", () => resolve(true), { once: true });
      ws.addEventListener("error", () => resolve(false), { once: true });
    });
    if (opened) {
      attempt = 0;
      say(`${green("●")} sharing this machine's ssh-agent with ${config.url}`);
      say(dim(`  agent: ${agentSock} · signature requests print here · Ctrl-C stops sharing`));
      ws.addEventListener("message", (event) => {
        const text =
          typeof event.data === "string"
            ? event.data
            : Buffer.from(event.data as ArrayBuffer).toString("utf8");
        let frame: { t?: string; id?: number; context?: string; payload?: string };
        try {
          frame = JSON.parse(text) as typeof frame;
        } catch {
          return;
        }
        if (
          frame.t !== "req" ||
          typeof frame.id !== "number" ||
          typeof frame.payload !== "string"
        ) {
          return;
        }
        const id = frame.id;
        const payload = Buffer.from(frame.payload, "base64");
        const type = payload[4];
        const context = typeof frame.context === "string" ? frame.context : "mend";
        chain = chain.then(async () => {
          const started = Date.now();
          if (type === SSH_AGENTC_SIGN_REQUEST) {
            say(`${amber("✎")} signature requested by mend ${dim(`(${context})`)}`);
            say(dim("  waiting — touch your key if it blinks (up to 60s)…"));
          } else if (type === SSH_AGENTC_REQUEST_IDENTITIES) {
            say(dim(`  identities requested (${context})`));
          }
          try {
            const response = await askLocalAgent(payload);
            if (ws.readyState !== WebSocket.OPEN) return null;
            ws.send(JSON.stringify({ t: "res", id, payload: response.toString("base64") }));
            if (type === SSH_AGENTC_SIGN_REQUEST) {
              say(
                `${green("✓")} signed ${dim(`(${((Date.now() - started) / 1000).toFixed(1)}s)`)}`,
              );
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ t: "err", id, message }));
            }
            if (type === SSH_AGENTC_SIGN_REQUEST) say(`${amber("✗")} not signed — ${message}`);
          }
          return null;
        });
      });
    }
    await closed;
    attempt += 1;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt - 1, 5));
    say(dim(`not connected — retrying in ${Math.round(delay / 1000)}s (Ctrl-C stops)`));
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
};

const keysCommand = async (config: CliConfig, args: ReadonlyArray<string>) => {
  const [verb] = args;
  switch (verb) {
    case "init":
      return keysInit(config);
    case "share":
      return keysShare(config);
    case "show":
    case undefined:
      return keysShow(config);
    default:
      return fail(`unknown keys command "${verb}" — try: mend keys init | show | share`);
  }
};

const formatDotfileBytes = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;

const dotfilesShow = async (config: CliConfig) => {
  const dotfiles = await api<DotfilesDto>(config, "GET", "/dotfiles");
  if (dotfiles.repository === null) {
    say(`repo      ${dim("none")}`);
  } else {
    const branch = dotfiles.repository.ref ?? "default branch";
    const subdir =
      dotfiles.repository.subdirectory === null ? [] : [`${dotfiles.repository.subdirectory}/`];
    const bootstrap = dotfiles.repository.bootstrap ? "install.sh on" : "install.sh off";
    say(
      `repo      ${dotfiles.repository.url} ${dim(`(${[branch, ...subdir, bootstrap].join(" · ")})`)}`,
    );
  }
  if (dotfiles.snapshot === null) {
    say(`snapshot  ${dim("none — sync from this machine: mend dotfiles sync --all")}`);
    return;
  }
  const snapshot = dotfiles.snapshot;
  say(
    `snapshot  ${snapshot.files.length} file${snapshot.files.length === 1 ? "" : "s"} · from ${snapshot.source} · ${dim(snapshot.sha.slice(0, 7))}`,
  );
  for (const file of snapshot.files) {
    say(`  ${file.path.padEnd(36)} ${dim(formatDotfileBytes(file.bytes))}`);
  }
};

/**
 * `mend dotfiles sync` — capture home files ON THIS MACHINE and stream them into the server's
 * per-user dotfiles store. This is the whole point of the store: the server may be a VPS whose
 * home directory belongs to a service account, so contents are read here, where they live.
 */
const dotfilesSync = async (config: CliConfig, args: ReadonlyArray<string>) => {
  const all = args.includes("--all");
  const requestedPaths = args.filter((arg) => !arg.startsWith("--"));
  const home = os.homedir();

  if (!all && requestedPaths.length === 0) {
    const found = scanDotfileCandidates(home);
    if (found.length === 0) {
      say(dim("no known config files found under ~"));
      return;
    }
    let group = "";
    for (const entry of found) {
      if (entry.group !== group) {
        group = entry.group;
        say(dim(group));
      }
      say(`  ${entry.path.padEnd(36)} ${dim(formatDotfileBytes(entry.bytes))}`);
    }
    say("");
    say(
      `sync everything with ${cobalt("mend dotfiles sync --all")}, or pick: ${cobalt("mend dotfiles sync .zshrc .gitconfig")}`,
    );
    return;
  }

  const selected = all ? scanDotfileCandidates(home).map((entry) => entry.path) : requestedPaths;
  if (selected.length === 0) return fail("nothing to sync — no known config files found under ~");
  const read = readSyncFiles(home, selected);
  if ("error" in read) return fail(read.error);

  const result = await api<DotfilesDto>(config, "POST", "/dotfiles/snapshot", {
    files: read.files,
    source: os.hostname(),
    merge: false,
  });
  const snapshot = result.snapshot;
  if (snapshot === null) return fail("the server accepted the sync but reports no snapshot");
  say(
    `${green("synced")} ${snapshot.files.length} file${snapshot.files.length === 1 ? "" : "s"} from ${os.hostname()} · ${dim(snapshot.sha.slice(0, 7))} ${dim("— applies from the next session launch")}`,
  );
};

// ─── env: the project env store ─────────────────────────────────────────────

interface ProjectEnvironmentDto {
  readonly revision: number;
  readonly variables: ReadonlyArray<{ readonly name: string; readonly updatedAt: string }>;
}
interface ProjectSecretsDto {
  readonly revision: number;
  readonly secrets: ReadonlyArray<{ readonly name: string; readonly updatedAt: string }>;
}

const envLoad = async (config: CliConfig, args: ReadonlyArray<string>) => {
  const explicitProject = takeFlagValue(args, "--project");
  // `--secret` alone sends everything to Secrets; `--secret A,B` only those names (for the
  // ordinary-looking ones that embed credentials, like DATABASE_URL). Routing is by NAME.
  const secretFlag = args.indexOf("--secret");
  const secretArg = secretFlag === -1 ? undefined : args[secretFlag + 1];
  const secretNames =
    secretArg !== undefined &&
    !secretArg.startsWith("--") &&
    !secretArg.includes("/") &&
    !secretArg.includes(".")
      ? secretArg
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s !== "")
      : [];
  const allSecret = secretFlag !== -1 && secretNames.length === 0;
  const consumed = new Set<number>();
  if (secretFlag !== -1 && secretNames.length > 0) consumed.add(secretFlag + 1);
  const positional = args.filter(
    (arg, i) => !arg.startsWith("--") && args[i - 1] !== "--project" && !consumed.has(i),
  );
  const file = path.resolve(positional[0] ?? ".env");
  let contents: string;
  try {
    contents = fs.readFileSync(file, "utf8");
  } catch {
    return fail(`cannot read ${file} — pass a path: mend env load path/to/.env`);
  }
  if (contents.trim() === "") {
    say(dim(`${file} is empty`));
    return;
  }
  const project = await findProject(config, explicitProject);
  const report = await api<EnvironmentLoadReportDto>(
    config,
    "POST",
    `/projects/${project.id}/environment/load`,
    { contents, allSecret, secretNames },
  );
  if (
    report.loaded.length === 0 &&
    report.rejected.length === 0 &&
    report.malformedLines.length === 0
  ) {
    say(dim(`${path.basename(file)} has no variables`));
    return;
  }
  say(`${green("✓")} loaded ${path.basename(file)} into ${project.name}`);
  for (const line of formatLoadReport(report, { dim, warn: amber })) say(line);
  const plaintextUrls = report.loaded.filter(
    (entry) => entry.lane === "configuration" && /_(URL|URI|DSN)$/.test(entry.name),
  );
  if (plaintextUrls.length > 0) {
    say(
      amber(
        `  ${plaintextUrls.map((entry) => entry.name).join(", ")} stored as plaintext configuration — if a value embeds a password, store it as a secret: mend env load --secret ${plaintextUrls.map((entry) => entry.name).join(",")}`,
      ),
    );
  }
  if (report.malformedLines.length > 0) {
    say(
      amber(
        `  skipped ${report.malformedLines.length} malformed line${report.malformedLines.length === 1 ? "" : "s"}: ${report.malformedLines.join(", ")}`,
      ),
    );
  }
  say(
    dim(
      `  configuration r${report.environmentRevision} · secrets r${report.secretRevision} — applies from the next workspace launch, including resume; running workspaces keep what they started with`,
    ),
  );
};

const envShow = async (config: CliConfig, args: ReadonlyArray<string>) => {
  const project = await findProject(config, takeFlagValue(args, "--project"));
  const [environment, secrets] = await Promise.all([
    api<ProjectEnvironmentDto>(config, "GET", `/projects/${project.id}/environment`),
    api<ProjectSecretsDto>(config, "GET", `/projects/${project.id}/secrets`),
  ]);
  say(
    `${project.name} ${dim(`· configuration r${environment.revision} · secrets r${secrets.revision}`)}`,
  );
  if (environment.variables.length === 0 && secrets.secrets.length === 0) {
    say(dim(`  nothing stored — load a file: ${cobalt("mend env load")}`));
    return;
  }
  const width = Math.max(
    ...environment.variables.map((v) => v.name.length),
    ...secrets.secrets.map((s) => s.name.length),
  );
  for (const variable of environment.variables) {
    say(`  ${variable.name.padEnd(width)}  configuration ${dim("· plaintext")}`);
  }
  for (const secret of secrets.secrets) {
    say(`  ${secret.name.padEnd(width)}  secret ${dim("· value set, never shown")}`);
  }
};

const envCommand = async (config: CliConfig, args: ReadonlyArray<string>) => {
  const [verb, ...rest] = args;
  switch (verb) {
    case "load":
      return envLoad(config, rest);
    case "show":
    case undefined:
      return envShow(config, rest);
    default:
      return fail(`unknown env command "${verb}" — try: mend env load | show`);
  }
};

const dotfilesCommand = async (config: CliConfig, args: ReadonlyArray<string>) => {
  const [verb, ...rest] = args;
  switch (verb) {
    case "sync":
      return dotfilesSync(config, rest);
    case "show":
    case undefined:
      return dotfilesShow(config);
    default:
      return fail(`unknown dotfiles command "${verb}" — try: mend dotfiles sync | show`);
  }
};

// ─── completions: live sessions under TAB ───────────────────────────────────

/**
 * The data half of shell completion: one live session per line as
 * `id<TAB>description`. Scripts adapt the shape (zsh wants `id:desc`, bash
 * wants bare ids). Never fails — a dead server just completes nothing.
 */
const completeCommand = async (config: CliConfig, args: ReadonlyArray<string>) => {
  if (args[0] !== "session") return;
  try {
    const [sessions, projects] = await Promise.all([
      request<ReadonlyArray<SessionDto>>(config, "GET", "/sessions"),
      request<ReadonlyArray<ProjectDto>>(config, "GET", "/projects"),
    ]);
    const nameById = new Map(projects.map((p) => [p.id, p.name]));
    for (const session of sessions) {
      const project = nameById.get(session.projectId) ?? "";
      process.stdout.write(`${session.id}\t${session.harness} · ${project} · ${session.branch}\n`);
    }
  } catch {
    // Completion must never surface an error into the user's TAB press.
  }
};

const ZSH_COMPLETIONS = `#compdef mend
_mend() {
  local -a commands
  commands=(
    'adopt:adopt a repository into the store'
    'codex:new session + codex' 'claude:new session + claude' 'opencode:new session + opencode'
    'run:new session + arbitrary command'
    'attach:reattach to a running session' 'shell:open a shell in a live session workspace'
    'service:reachable ports — add, list, stop'
    'keys:the machine Mend deploy key — init, show, share'
    'continue:resume with the pending follow-up' 'resume:rejoin a settled session'
    'rejoin:attach if live, otherwise resume'
    'projects:adopted projects' 'sessions:sessions with review facts' 'status:active sessions'
    'ui:the dashboard' 'help:help'
  )
  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi
  case $words[2] in
    shell|attach|continue|resume|rejoin)
      local -a sessions
      sessions=(\${(f)"$(command mend __complete session 2>/dev/null | tr '\\t' ':')"})
      (( \${#sessions} )) && _describe 'session' sessions
      ;;
  esac
}
_mend "$@"
`;

const BASH_COMPLETIONS = `_mend() {
  local cur=\${COMP_WORDS[COMP_CWORD]}
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "adopt codex claude opencode run attach shell service keys continue resume rejoin projects sessions status ui help" -- "$cur") )
    return
  fi
  case \${COMP_WORDS[1]} in
    shell|attach|continue|resume|rejoin)
      COMPREPLY=( $(compgen -W "$(command mend __complete session 2>/dev/null | cut -f1)" -- "$cur") )
      ;;
  esac
}
complete -F _mend mend
`;

/** Print the hook for the named shell; the user wires it into their rc file. */
const completionsCommand = (args: ReadonlyArray<string>) => {
  switch (args[0]) {
    case "zsh":
      process.stdout.write(ZSH_COMPLETIONS);
      return;
    case "bash":
      process.stdout.write(BASH_COMPLETIONS);
      return;
    default:
      return fail(
        'usage: mend completions zsh|bash — e.g. mend completions zsh > "$fpath[1]/_mend"',
      );
  }
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
  readonly reviewSliceId: string | null;
  readonly checkpointAId: string | null;
  readonly checkpointBId: string | null;
  readonly diffDigest: string | null;
  readonly commentIds: ReadonlyArray<string>;
  readonly idempotencyKey: string | null;
  readonly instruction: string;
  readonly status: "pending" | "delivering" | "delivered" | "delivery_failed" | "superseded";
  readonly deliverySealantRunId: string | null;
  readonly deliveryError: string | null;
}

interface ProjectDetailDto {
  readonly project: ProjectDto;
  readonly sessions: ReadonlyArray<SessionDto>;
  readonly annotations: ReadonlyArray<SessionAnnotationDto>;
}

/**
 * The second half of the review loop (plan §7.3): find the session with a
 * pending follow-up and retry the one server-owned delivery operation. The
 * server persists intent, launches, correlates membership, and finalizes.
 */
const continueSession = async (config: CliConfig, args: ReadonlyArray<string>) => {
  const explicitSession = args.find((a) => !a.startsWith("--")) ?? null;

  let sessionId = explicitSession;
  let followUp: FollowUpDto | null = null;
  if (sessionId === null) {
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
  } else {
    followUp = await api<FollowUpDto | null>(config, "GET", `/sessions/${sessionId}/follow-up`);
    if (followUp === null) return fail(`session ${sessionId} has no pending follow-up`);
  }

  const detail = await api<{ readonly session: SessionDto }>(
    config,
    "GET",
    `/sessions/${sessionId}`,
  );
  const session = detail.session;
  say(`${green("✓")} follow-up for session ${dim(session.id.slice(0, 8))} · ${session.branch}`);
  say(dim("  instruction:"));
  for (const line of followUp.instruction.split("\n").slice(0, 6)) say(dim(`  │ ${line}`));
  if (followUp.instruction.split("\n").length > 6) say(dim("  │ …"));

  if (
    followUp.reviewSliceId === null ||
    followUp.checkpointAId === null ||
    followUp.checkpointBId === null ||
    followUp.diffDigest === null ||
    followUp.idempotencyKey === null
  ) {
    return fail("legacy follow-up — recreate it from a pinned Review before delivery");
  }

  const delivered = await withSpinner(
    "delivering persisted Review bundle — retries reconcile one process…",
    api<FollowUpDto>(config, "POST", `/sessions/${session.id}/follow-up/deliver`, {
      reviewSliceId: followUp.reviewSliceId,
      checkpointAId: followUp.checkpointAId,
      checkpointBId: followUp.checkpointBId,
      diffDigest: followUp.diffDigest,
      commentIds: followUp.commentIds,
      instruction: followUp.instruction,
      idempotencyKey: followUp.idempotencyKey,
    }),
  );
  if (delivered.status === "pending") {
    return fail("the session is active — the follow-up remains pending");
  }
  if (delivered.status === "delivery_failed") {
    return fail(delivered.deliveryError ?? "delivery failed before process membership finalized");
  }
  say(
    `${green("✓ recording")} · delivered to run ${delivered.deliverySealantRunId ?? "unknown"}${detachHint()}`,
  );
  say(`${cobalt("  watch")} · ${config.url}/sessions/${session.id}`);
  say("");
  await attachOrExit(config, session.id, session.harness);
  exitAfterSessionEnd(config, session.id);
};

// ─── resume: rejoin a session — same worktree, restored harness state ───────

const ACTIVE_STATUSES = LIVE_STATUSES;

/**
 * Sessions are continuous work, not runs: `mend resume` rejoins one on a
 * fresh workspace — saved harness state restored, a claude resume is native
 * (conversation intact). `--with <harness>` re-opens the same work in a
 * DIFFERENT harness: the conversation crosses as a distilled opening prompt.
 */
const resumeCommand = async (config: CliConfig, args: ReadonlyArray<string>) => {
  const withFlag = args.indexOf("--with");
  const withHarness =
    withFlag !== -1 && args[withFlag + 1] !== undefined ? String(args[withFlag + 1]) : null;
  const prefix = args.find((a, i) => !a.startsWith("--") && i !== withFlag + 1);

  const project = await findProject(config, null);
  const detail = await api<ProjectDetailDto>(config, "GET", `/projects/${project.id}`);
  const match =
    prefix === undefined
      ? detail.sessions.find((s) => !ACTIVE_STATUSES.has(s.status))
      : detail.sessions.find((s) => s.id.startsWith(prefix));
  if (match === undefined) {
    return fail(
      prefix === undefined
        ? "no settled session to resume — mend status lists sessions"
        : `no session matches "${prefix}"`,
    );
  }
  if (ACTIVE_STATUSES.has(match.status)) {
    return fail(
      `session ${match.id.slice(0, 8)} is live — attach: mend attach ${match.id.slice(0, 8)}`,
    );
  }

  say(
    `${green("✓")} resuming ${match.harness} · ${dim(match.id.slice(0, 8))}${withHarness === null ? "" : ` ${dim("as")} ${withHarness}`}`,
  );
  say(`${cobalt("  watch")} · ${config.url}/sessions/${match.id}`);
  await withSpinner(
    "resuming — a fresh workspace restores the saved session state…",
    api<SessionDto>(config, "POST", `/sessions/${match.id}/resume`, { harness: withHarness }),
  );
  say(`${green("✓ recording")} · same worktree, conversation restored${detachHint()}`);
  say("");
  await attachOrExit(config, match.id, withHarness ?? match.harness);
  exitAfterSessionEnd(config, match.id);
};

// ─── rejoin: one entrypoint for an outer multiplexer ────────────────────────

/**
 * Idempotent entrypoint for outer multiplexers: attach when the session is
 * live, otherwise restore and resume it before attaching. With no id, the
 * newest live session wins, falling back to the newest settled session;
 * --harness narrows the choice.
 */
const resumeForRejoin = async (config: CliConfig, sessionId: string, label: string) => {
  try {
    await withSpinner(
      label,
      request<SessionDto>(config, "POST", `/sessions/${sessionId}/resume`, { harness: null }),
    );
    return true;
  } catch (error) {
    const refreshed = await api<{ readonly session: SessionDto }>(
      config,
      "GET",
      `/sessions/${sessionId}`,
    );
    if (ACTIVE_STATUSES.has(refreshed.session.status)) return false;
    return fail(error instanceof Error ? error.message : String(error));
  }
};

const rejoinCommand = async (config: CliConfig, args: ReadonlyArray<string>) => {
  const harnessFlag = args.indexOf("--harness");
  const harness =
    harnessFlag !== -1 && args[harnessFlag + 1] !== undefined
      ? String(args[harnessFlag + 1])
      : null;
  const prefix = args.find((arg, index) => !arg.startsWith("--") && index !== harnessFlag + 1);

  const project = await findProject(config, null);
  const detail = await api<ProjectDetailDto>(config, "GET", `/projects/${project.id}`);
  const eligible = detail.sessions
    .filter((session) => harness === null || session.harness === harness)
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
  const newest = eligible.find((session) => ACTIVE_STATUSES.has(session.status)) ?? eligible[0];
  const matches =
    prefix === undefined
      ? newest === undefined
        ? []
        : [newest]
      : eligible.filter((session) => session.id.startsWith(prefix));

  if (matches.length === 0) {
    const harnessDescription = harness === null ? "" : ` ${harness}`;
    return fail(
      prefix === undefined
        ? `no${harnessDescription} session to rejoin in project ${project.name}`
        : `no${harnessDescription} session matches "${prefix}" in project ${project.name}`,
    );
  }
  if (matches.length > 1) {
    return fail(`session prefix "${prefix}" is ambiguous — use more of the id`);
  }

  const session = matches[0];
  if (session === undefined) return fail("session selection failed");
  say(
    `${green("✓")} rejoining ${session.harness} · ${dim(session.id.slice(0, 8))} · ${ACTIVE_STATUSES.has(session.status) ? "already live" : "restoring"}`,
  );
  say(`${cobalt("  watch")} · ${config.url}/sessions/${session.id}`);

  let restored = false;
  if (!ACTIVE_STATUSES.has(session.status)) {
    restored = await resumeForRejoin(
      config,
      session.id,
      "resuming — a fresh workspace restores the saved session state…",
    );
  }
  say(
    restored
      ? `${green("✓ recording")} · same worktree, conversation restored${detachHint()}`
      : `${green("✓ recording")} · attached to the live session${detachHint()}`,
  );
  say("");
  let outcome = await attachTty(config, session.id, session.harness, 0n);
  if (outcome === "unavailable") {
    const refreshed = await api<{ readonly session: SessionDto }>(
      config,
      "GET",
      `/sessions/${session.id}`,
    );
    if (!ACTIVE_STATUSES.has(refreshed.session.status)) {
      await resumeForRejoin(
        config,
        session.id,
        "session settled while attaching — restoring it once…",
      );
    }
    outcome = await attachTty(config, session.id, session.harness, 0n);
  }
  finishAttach(config, session.id, outcome);
  exitAfterSessionEnd(config, session.id);
};

// ─── projects · sessions: the workbench at a glance ─────────────────────────

const projectsCommand = async (config: CliConfig) => {
  const [projects, active] = await Promise.all([
    api<ReadonlyArray<ProjectDto>>(config, "GET", "/projects"),
    api<ReadonlyArray<SessionDto>>(config, "GET", "/sessions"),
  ]);
  if (projects.length === 0) {
    say(dim("no adopted projects — mend adopt brings one in"));
    return;
  }
  const liveByProject = new Map<string, number>();
  for (const session of active) {
    liveByProject.set(session.projectId, (liveByProject.get(session.projectId) ?? 0) + 1);
  }
  const nameWidth = Math.max(...projects.map((p) => p.name.length));
  const branchWidth = Math.max(...projects.map((p) => p.defaultBranch.length));
  for (const project of projects) {
    const live = liveByProject.get(project.id) ?? 0;
    const liveLabel = live > 0 ? green(`${live} live`) : dim("—");
    say(
      `${project.name.padEnd(nameWidth)}  ${dim(project.defaultBranch.padEnd(branchWidth))}  ${liveLabel}  ${dim(project.storePath)}`,
    );
  }
};

interface SessionRow {
  readonly session: SessionDto;
  readonly projectName: string;
  readonly annotation: SessionAnnotationDto | undefined;
}

interface SessionJson {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly harness: string;
  readonly label: string | null;
  readonly worktree: string;
  readonly branch: string;
  readonly baseSha: string;
  readonly status: string;
  readonly summary: string | null;
  readonly createdAt: string;
  readonly reviewUrl: string;
  readonly review: {
    readonly openComments: number;
    readonly totalComments: number;
    readonly pendingFollowUp: boolean;
  } | null;
}

interface SessionsJson {
  readonly version: 1;
  readonly sessions: ReadonlyArray<SessionJson>;
}

const printSessionRow = (row: SessionRow) => {
  const { session, annotation } = row;
  const live = ACTIVE_STATUSES.has(session.status);
  const status = session.status.padEnd(9);
  const facts: Array<string> = [];
  if (session.label !== null) facts.push(session.label);
  if (annotation !== undefined && annotation.openComments > 0) {
    facts.push(amber(`${annotation.openComments} open`));
  }
  if (annotation !== undefined && annotation.pendingFollowUp)
    facts.push(amber("follow-up pending"));
  say(
    `${session.harness.padEnd(8)}  ${dim(session.id.slice(0, 8))}  ${live ? green(status) : dim(status)}  ${row.projectName}  ${dim(session.branch)}${facts.length > 0 ? `  ${facts.join(dim(" · "))}` : ""}`,
  );
};

/**
 * Active sessions by default; --all sweeps every project's detail so settled
 * sessions arrive with their review facts (open comments, pending follow-up).
 */
const sessionsCommand = async (config: CliConfig, args: ReadonlyArray<string>) => {
  const all = args.includes("--all");
  const json = args.includes("--json");
  const projectFlag = args.indexOf("--project");
  const projectName =
    projectFlag !== -1 && args[projectFlag + 1] !== undefined
      ? String(args[projectFlag + 1])
      : null;

  const projects = await api<ReadonlyArray<ProjectDto>>(config, "GET", "/projects");
  const scope = projectName === null ? projects : projects.filter((p) => p.name === projectName);
  if (projectName !== null && scope.length === 0) {
    return fail(`no adopted project named "${projectName}"`);
  }

  let rows: Array<SessionRow>;
  if (all || projectName !== null) {
    const details = await Promise.all(
      scope.map((p) => api<ProjectDetailDto>(config, "GET", `/projects/${p.id}`)),
    );
    rows = details.flatMap((detail) =>
      detail.sessions.map((session) => ({
        session,
        projectName: detail.project.name,
        annotation: detail.annotations.find((a) => a.sessionId === session.id),
      })),
    );
  } else {
    const active = await api<ReadonlyArray<SessionDto>>(config, "GET", "/sessions");
    const nameById = new Map(projects.map((p) => [p.id, p.name]));
    rows = active.map((session) => ({
      session,
      projectName: nameById.get(session.projectId) ?? session.projectId.slice(0, 8),
      annotation: undefined,
    }));
  }
  if (rows.length === 0) {
    if (json) {
      say(JSON.stringify({ version: 1, sessions: [] } satisfies SessionsJson, null, 2));
      return;
    }
    say(
      dim(all ? "no sessions" : "no active sessions — mend sessions --all includes settled ones"),
    );
    return;
  }
  rows.sort((a, b) => {
    const aLive = ACTIVE_STATUSES.has(a.session.status) ? 1 : 0;
    const bLive = ACTIVE_STATUSES.has(b.session.status) ? 1 : 0;
    if (aLive !== bLive) return bLive - aLive;
    return b.session.createdAt.localeCompare(a.session.createdAt);
  });
  if (json) {
    const payload: SessionsJson = {
      version: 1,
      sessions: rows.map(({ session, projectName: rowProjectName, annotation }) => ({
        id: session.id,
        projectId: session.projectId,
        projectName: rowProjectName,
        harness: session.harness,
        label: session.label,
        worktree: session.worktree,
        branch: session.branch,
        baseSha: session.baseSha,
        status: session.status,
        summary: session.summary,
        createdAt: session.createdAt,
        reviewUrl: `${config.url.replace(/\/$/, "")}/sessions/${session.id}`,
        review:
          annotation === undefined
            ? null
            : {
                openComments: annotation.openComments,
                totalComments: annotation.totalComments,
                pendingFollowUp: annotation.pendingFollowUp,
              },
      })),
    };
    say(JSON.stringify(payload, null, 2));
    return;
  }
  for (const row of rows) printSessionRow(row);
};

// ─── dashboard: the live TUI on bare `mend` ─────────────────────────────────

const hasNodeFfi = (): boolean => {
  try {
    createRequire(import.meta.url)("node:ffi");
    return true;
  } catch {
    return false;
  }
};

/**
 * The dashboard needs @opentui/core, whose Node backend binds the native
 * renderer over node:ffi — present from Node 26, and only behind
 * --experimental-ffi. Gate here and re-exec the same argv with the flag so
 * the user never types it; every other command stays on plain Node >= 22.
 */
const dashboard = async (config: CliConfig) => {
  if (process.stdout.isTTY !== true) {
    say(HELP);
    return;
  }
  if (!hasNodeFfi()) {
    const major = Number(process.versions.node.split(".")[0]);
    if (Number.isNaN(major) || major < 26) {
      return fail(
        `the dashboard needs Node >= 26 (node:ffi) — this is ${process.version}; every other command still works`,
      );
    }
    const rerun = spawnSync(
      process.execPath,
      ["--experimental-ffi", "--disable-warning=ExperimentalWarning", ...process.argv.slice(1)],
      { stdio: "inherit" },
    );
    process.exit(rerun.status ?? 0);
  }
  const { runDashboard } = await import("./dashboard.tsx");
  await runDashboard({
    config,
    cwd: process.cwd(),
    api: <T>(method: "GET" | "POST", route: string, body?: unknown) =>
      request<T>(config, method, route, body),
    attachTty: (sessionId: string, harness: string) => attachTty(config, sessionId, harness, 0n),
  });
};

// ─── entry ──────────────────────────────────────────────────────────────────

const HELP = `mend — the agent workbench

  mend                                  the dashboard: every project and session, live
  mend adopt [source] [--name <name>] [--auth ambient|mend-key|bridge]
                                        adopt a repository into the store (default: cwd; any git
                                        URL — GitHub, GitLab, self-hosted, ssh://, a local path)
  mend login [--url <server>]           sign in with email + password; saves the token (0600)
  mend logout                           forget the saved token
  mend keys init                        generate the machine's Mend deploy key (ed25519)
  mend keys show                        print the public key — add it as a deploy key on your git host
  mend env load [file] [--secret [A,B]] load a .env into the project: ordinary names → configuration,
                                        secret-shaped names → secrets; --secret sends all (or the
                                        named ones, e.g. DATABASE_URL) to secrets
  mend env show                         what the project store holds — names only, never values
  mend dotfiles                         your dotfiles on the server: repo + synced home files
  mend dotfiles sync [--all | paths…]   capture config files from THIS machine into your store
  mend keys share                       relay THIS machine's ssh-agent to the server (bridge mode:
                                        hardware keys sign here; Ctrl-C stops sharing)
  mend codex|claude|opencode ["prompt"] [--model <id>] [--effort low|medium|high|xhigh|max]
                             [--base <ref>] [--ask] [--fast]
                                        new session worktree + launch the harness in it; a quoted
                                        prompt becomes its first message (and names the session),
                                        --ask restores the harness's permission prompts, --fast
                                        requests priority processing (codex service tier)
  mend run -- <command...>              same, with an arbitrary command
  mend attach <session-id-prefix>       reattach this terminal to a running session
  mend shell [session-id-prefix]        open a shell in a live session's workspace
  mend service run [session] --port <p> [--name <n>] [--udp] -- <command...>
                                        start + supervise a server in the session workspace
  mend service run [session] <name>     start a declared Service (mend.toml recipe)
  mend service <name>                   shorthand for the above
  mend service init [--yes]             scaffold mend.toml from package.json + compose ports
  mend service add [session] <port> [--name <n>] [--udp]
                                        adopt a listening workspace port — reachable on this machine
  mend service list                     every live service and its observed state
  mend service logs <name-or-id>        follow a supervised service's output (replay, then live)
  mend service restart <name-or-id>     re-run its recorded command — same URL
  mend service stop <name-or-id>        stop a service (closes its host port)
  mend continue [session-id]            resume a session with its pending review follow-up
  mend resume [session-id] [--with h]   rejoin a settled session (state restored; --with switches harness)
  mend rejoin [session-id] [--harness h] attach if live, otherwise resume; newest live wins
  mend projects                         adopted projects and their live sessions
  mend sessions [--all] [--project p] [--json]
                                        sessions with review facts; JSON is stable for integrations
  mend status                           active sessions (alias of mend sessions)
  mend completions zsh|bash             print the TAB-completion hook (live session ids under TAB)

  server: MEND_URL (default http://localhost:3105) · auth: MEND_TOKEN
  detach key: Ctrl+] (set MEND_DETACH_KEY=none when an outer multiplexer owns detaching)
  config file: ~/.config/mend/cli.json { "url": ..., "token": ... }
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
    case "shell":
      return shellCommand(config, rest);
    case "service":
      return serviceCommand(config, rest);
    case "login":
      return login(config, rest);
    case "logout":
      return logout(config);
    case "keys":
      return keysCommand(config, rest);
    case "dotfiles":
      return dotfilesCommand(config, rest);
    case "env":
      return envCommand(config, rest);
    case "completions":
      return completionsCommand(rest);
    case "__complete":
      return completeCommand(config, rest);
    case "continue":
      return continueSession(config, rest);
    case "resume":
      return resumeCommand(config, rest);
    case "rejoin":
      return rejoinCommand(config, rest);
    case "projects":
      return projectsCommand(config);
    case "sessions":
    case "status":
      return sessionsCommand(config, rest);
    case undefined:
    case "ui":
      return dashboard(config);
    case "help":
    case "--help":
      say(HELP);
      return;
    default:
      return fail(`unknown command "${command}" — try: mend help`);
  }
};

await main();

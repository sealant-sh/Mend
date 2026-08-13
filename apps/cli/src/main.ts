#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";

import {
  isComposeFile,
  proposeFromCompose,
  proposeFromPackageJson,
  proposeFromWorkspacePackage,
  renderMendToml,
  workspaceGlobs,
} from "./service-init.ts";
import {
  CONTINUE_COMMANDS,
  gitTopLevel,
  HARNESS_COMMANDS,
  LIVE_STATUSES,
  matchProjectByCwd,
  normalizeProjectName,
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
      `unauthorized — set MEND_TOKEN (or "token" in ${CONFIG_PATH}) to a bearer token for ${config.url}`,
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
  return JSON.parse(text) as T;
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
  if (auth !== null && auth !== "ambient" && auth !== "mend-key") {
    return fail(`--auth takes "ambient" or "mend-key", not "${auth}"`);
  }

  const project = await api<ProjectDto>(config, "POST", "/projects", {
    name: projectName,
    source,
    ...(auth === null ? {} : { gitAuthMode: auth }),
  });
  say(`${green("✓")} adopted · ${project.name} · ${dim(project.storePath)}`);
  say(`${dim("  default branch")} ${project.defaultBranch}`);
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

  const project = await findProject(config, explicit, true);
  const session = await api<SessionDto>(config, "POST", `/projects/${project.id}/sessions`, {
    harness,
    label: null,
    base: null,
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
  await withSpinner(
    "provisioning workspace — a first launch builds the harness image (can take minutes)…",
    api<SessionDto>(config, "POST", `/sessions/${session.id}/launch`, { argv }),
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
  const url = new URL(`${config.url}/api/tty`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  // Process addressing reaches any PTY in the workspace (a shell); the
  // session form remains the agent's PTY.
  if (processId !== undefined) url.searchParams.set("process", processId);
  else url.searchParams.set("session", sessionId);
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
  const sessions = await api<ReadonlyArray<SessionDto>>(config, "GET", "/sessions");
  if (prefix !== undefined) {
    const matches = sessions.filter((s) => s.id.startsWith(prefix));
    if (matches.length === 0) return fail(`no live session matches "${prefix}"`);
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
    return fail("no live session — start one with mend codex|claude|opencode");
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
}

interface ServiceDto {
  readonly id: string;
  readonly sessionId: string;
  readonly kind: string;
  readonly label: string | null;
  readonly status: string;
  readonly workspacePort: number | null;
  readonly hostPort: number | null;
  readonly protocol: "tcp" | "udp";
  readonly sealantSessionId: string | null;
}

const serviceUrl = (config: CliConfig, service: ServiceDto): string => {
  const host = new URL(config.url).hostname || "localhost";
  // A UDP Service has no page to open — the endpoint is the whole fact.
  return service.protocol === "udp"
    ? `${host}:${service.hostPort ?? "?"} (udp)`
    : `http://${host}:${service.hostPort ?? "?"}`;
};

const printService = (config: CliConfig, service: ServiceDto) => {
  const status = service.status === "reachable" ? green(service.status) : amber(service.status);
  say(
    `${(service.label ?? service.id.slice(0, 8)).padEnd(12)}  ${dim(`:${service.workspacePort ?? "?"}${service.protocol === "udp" ? "/udp" : ""} →`)} ${serviceUrl(config, service)}  ${status}  ${dim(service.id.slice(0, 8))}`,
  );
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
  const positional = args.filter(
    (a, i) => !a.startsWith("--") && (nameFlag === -1 || i !== nameFlag + 1),
  );
  const portRaw = positional.find((a) => /^\d+$/.test(a));
  if (portRaw === undefined) {
    return fail("usage: mend service add [session] <port> [--name <n>] [--udp]");
  }
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return fail(`"${portRaw}" is not a port`);
  }
  const prefix = positional.find((a) => a !== portRaw);
  const session = await resolveLiveSession(config, prefix);

  const service = await api<ServiceDto>(config, "POST", `/sessions/${session.id}/services`, {
    port,
    name,
    protocol,
  });
  say(`${green("✓")} Service ${service.label ?? ""} · ${service.status}`);
  say(`  ${cobalt(serviceUrl(config, service))}`);
  if (protocol === "udp") {
    say(dim(`  udp — a reply is the only reachability signal; silence just relays`));
  } else if (service.status !== "reachable") {
    say(dim(`  nothing answered on :${port} yet — the URL goes live when something listens`));
  }
};

const serviceList = async (config: CliConfig) => {
  const services = await api<ReadonlyArray<ServiceDto>>(config, "GET", "/services");
  if (services.length === 0) {
    say(dim("no live services — mend service add <port> adopts a listening one"));
    return;
  }
  for (const service of services) printService(config, service);
};

const serviceStop = async (config: CliConfig, args: ReadonlyArray<string>) => {
  const needle = args.find((a) => !a.startsWith("--"));
  if (needle === undefined) return fail("usage: mend service stop <name-or-id-prefix>");
  const services = await api<ReadonlyArray<ServiceDto>>(config, "GET", "/services");
  const matches = services.filter(
    (service) => service.label === needle || service.id.startsWith(needle),
  );
  if (matches.length === 0) return fail(`no live service matches "${needle}"`);
  const match = matches[0];
  if (matches.length > 1 || match === undefined) {
    return fail(`"${needle}" is ambiguous — use more of the id`);
  }
  const stoppedService = await api<ServiceDto>(config, "POST", `/services/${match.id}/stop`);
  say(`${green("✓")} stopped · ${stoppedService.label ?? stoppedService.id.slice(0, 8)}`);
};

const findLiveService = async (config: CliConfig, needle: string): Promise<ServiceDto> => {
  const services = await api<ReadonlyArray<ServiceDto>>(config, "GET", "/services");
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
    "usage: mend service run [session] --port <port> [--name <n>] [--udp] -- <command...>\n" +
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
    if (recipe.command === null) {
      // A port-only recipe is an adopt: something else starts the listener.
      const service = await api<ServiceDto>(config, "POST", `/sessions/${session.id}/services`, {
        port: recipe.port,
        name: recipe.name,
        protocol: recipe.protocol,
      });
      say(`${green("✓")} Service ${service.label ?? ""} · ${service.status}`);
      say(`  ${cobalt(serviceUrl(config, service))}`);
      return;
    }
    const service = await withSpinner(
      recipe.protocol === "udp"
        ? `starting ${recipe.name} (udp :${recipe.port})…`
        : `starting ${recipe.name} — waiting for :${recipe.port} to answer…`,
      api<ServiceDto>(config, "POST", `/sessions/${session.id}/services/run`, {
        argv: ["sh", "-c", recipe.command],
        port: recipe.port,
        name: recipe.name,
        protocol: recipe.protocol,
      }),
    );
    say(`${green("✓")} Service ${service.label ?? ""} · ${service.status}`);
    say(`  ${cobalt(serviceUrl(config, service))}`);
    say(dim(`  logs: mend service logs ${service.label ?? service.id.slice(0, 8)}`));
    return;
  }
  const argv = args.slice(dashdash + 1);
  if (argv.length === 0) return fail(usage);
  const head = args.slice(0, dashdash);
  const portFlag = head.indexOf("--port");
  const port = portFlag !== -1 ? Number(head[portFlag + 1]) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return fail(usage);
  const nameFlag = head.indexOf("--name");
  const name =
    nameFlag !== -1 && head[nameFlag + 1] !== undefined ? String(head[nameFlag + 1]) : null;
  const protocol = head.includes("--udp") ? ("udp" as const) : ("tcp" as const);
  const prefix = head.find(
    (a, i) => !a.startsWith("--") && i !== portFlag + 1 && i !== nameFlag + 1,
  );
  const session = await resolveLiveSession(config, prefix);

  const service = await withSpinner(
    protocol === "udp"
      ? `starting ${name ?? argv[0]} (udp :${port})…`
      : `starting ${name ?? argv[0]} — waiting for :${port} to answer…`,
    api<ServiceDto>(config, "POST", `/sessions/${session.id}/services/run`, {
      argv,
      port,
      name,
      protocol,
    }),
  );
  say(`${green("✓")} Service ${service.label ?? ""} · ${service.status}`);
  say(`  ${cobalt(serviceUrl(config, service))}`);
  say(dim(`  logs: mend service logs ${service.label ?? service.id.slice(0, 8)}`));
};

/**
 * Watch a supervised Service's output: record replay, then live tail. A DEAD
 * Service still answers — its record outlives the process — printed once
 * instead of followed.
 */
const serviceLogs = async (config: CliConfig, args: ReadonlyArray<string>) => {
  const needle = args.find((a) => !a.startsWith("--"));
  if (needle === undefined) return fail("usage: mend service logs <name-or-id-prefix>");
  const everything = await api<ReadonlyArray<ServiceDto>>(config, "GET", "/services?all=1");
  const matches = everything.filter(
    (service) => service.label === needle || service.id.startsWith(needle),
  );
  if (matches.length === 0) return fail(`no service matches "${needle}"`);
  // Prefer the live one; otherwise the newest ended one (list is newest-first).
  const service =
    matches.find((m) => m.status !== "exited" && m.status !== "stopped") ?? matches[0];
  if (service === undefined) return fail(`no service matches "${needle}"`);
  if (service.sealantSessionId === null) {
    return fail(
      `"${needle}" is an adopted port — no process of Mend's, no logs. mend service run supervises.`,
    );
  }
  if (service.status === "exited" || service.status === "stopped") {
    // Post-mortem: print the record, don't attach.
    const output = await api<{ readonly text: string }>(
      config,
      "GET",
      `/processes/${service.id}/output`,
    );
    say(dim(`${service.label ?? service.id.slice(0, 8)} · ${service.status} — recorded output:`));
    say("");
    process.stdout.write(output.text.endsWith("\n") ? output.text : `${output.text}\n`);
    process.exit(0);
  }
  say(
    dim(
      `following ${service.label ?? service.id.slice(0, 8)} — Ctrl+C detaches, the service keeps running`,
    ),
  );
  say("");
  const outcome = await attachTty(config, service.sessionId, "service", 0n, service.id, {
    readOnly: true,
  });
  if (outcome === "unavailable") {
    return fail(`tty attach unavailable: could not connect to ${config.url}`);
  }
  say("");
  say(dim("stream ended"));
  process.exit(0);
};

const serviceRestart = async (config: CliConfig, args: ReadonlyArray<string>) => {
  const needle = args.find((a) => !a.startsWith("--"));
  if (needle === undefined) return fail("usage: mend service restart <name-or-id-prefix>");
  const service = await findLiveService(config, needle);
  const restarted = await withSpinner(
    `restarting ${service.label ?? service.id.slice(0, 8)}…`,
    api<ServiceDto>(config, "POST", `/services/${service.id}/restart`),
  );
  say(`${green("✓")} restarted · ${restarted.status}`);
  say(`  ${cobalt(serviceUrl(config, restarted))}`);
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

const keysCommand = async (config: CliConfig, args: ReadonlyArray<string>) => {
  const [verb] = args;
  switch (verb) {
    case "init":
      return keysInit(config);
    case "show":
    case undefined:
      return keysShow(config);
    default:
      return fail(`unknown keys command "${verb}" — try: mend keys init | mend keys show`);
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
    'keys:the machine Mend deploy key — init, show'
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
  readonly instruction: string;
  readonly status: string;
}

interface ProjectDetailDto {
  readonly project: ProjectDto;
  readonly sessions: ReadonlyArray<SessionDto>;
  readonly annotations: ReadonlyArray<SessionAnnotationDto>;
}

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
  say(`${cobalt("  watch")} · ${config.url}/sessions/${session.id}`);

  // Relaunch SUPERVISED, exactly like a fresh `mend <harness>`: a new
  // workspace mounts the SAME worktree, the platform PTY runs the harness
  // with the instruction as its opening prompt, and the record continues —
  // the web session page shows the live terminal throughout.
  const argv = build(followUp.instruction);
  await withSpinner(
    "provisioning workspace — the resumed run records like any other…",
    api<SessionDto>(config, "POST", `/sessions/${session.id}/launch`, { argv }),
  );
  say(`${green("✓ recording")} · workspace mounts the worktree${detachHint()}`);
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
    prefix !== undefined
      ? detail.sessions.find((s) => s.id.startsWith(prefix))
      : detail.sessions.find((s) => !ACTIVE_STATUSES.has(s.status));
  if (match === undefined) {
    return fail(
      prefix !== undefined
        ? `no session matches "${prefix}"`
        : "no settled session to resume — mend status lists sessions",
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
  mend adopt [source] [--name <name>] [--auth ambient|mend-key]
                                        adopt a repository into the store (default: cwd; any git
                                        URL — GitHub, GitLab, self-hosted, ssh://, a local path)
  mend keys init                        generate the machine's Mend deploy key (ed25519)
  mend keys show                        print the public key — add it as a deploy key on your git host
  mend codex|claude|opencode            new session worktree + launch the harness in it
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
    case "shell":
      return shellCommand(config, rest);
    case "service":
      return serviceCommand(config, rest);
    case "keys":
      return keysCommand(config, rest);
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

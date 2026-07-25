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
  say(
    amber("  recording: off") +
      dim(
        " — supervised launch lands with the platform mount/PTY work; worktree, checkpoints, and review are live",
      ),
  );
  say(dim(`  launching ${argv.join(" ")} in the worktree…`));
  say("");

  const [command = "", ...rest] = argv;
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
  say(
    `${cobalt("  review")} · ${config.url}/changes — worktree vs ${dim(session.baseSha.slice(0, 12))}`,
  );
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

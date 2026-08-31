import { spawnSync } from "node:child_process";
import * as path from "node:path";

/**
 * Facts both entry points need: how each harness launches and resumes, which
 * session statuses mean "live", and how a cwd resolves to an adopted project.
 * Kept dependency-free so main.ts stays runnable on plain Node >= 22.
 */

export const HARNESS_COMMANDS: Record<string, ReadonlyArray<string>> = {
  codex: ["codex"],
  claude: ["claude"],
  opencode: ["opencode"],
  // Not a coding agent: a plain bash session in its own recorded worktree.
  shell: ["bash"],
};

/** How each harness takes an instruction as its opening prompt. */
export const CONTINUE_COMMANDS: Record<string, (instruction: string) => ReadonlyArray<string>> = {
  codex: (instruction) => ["codex", instruction],
  claude: (instruction) => ["claude", instruction],
  opencode: (instruction) => ["opencode", "run", instruction],
};

/** Mirror of @mend/domain/workbench harness-launch.ts — the CLI ships dependency-free. */
export const EFFORT_LEVELS: ReadonlyArray<string> = ["low", "medium", "high", "xhigh", "max"];

/**
 * Ids of optimistic cache rows the server has not named yet — a session still
 * provisioning, a review comment still saving. Anything that would send such
 * an id to the server checks here first and waits instead.
 */
export const PENDING_ID_PREFIX = "pending:";
export const pendingId = (): string => `${PENDING_ID_PREFIX}${crypto.randomUUID()}`;
export const isPendingId = (id: string): boolean => id.startsWith(PENDING_ID_PREFIX);

/** A parsed `mend <harness> …` invocation; `error` set means "print and exit". */
export interface LaunchArgs {
  readonly project: string | null;
  readonly prompt: string | null;
  readonly model: string | null;
  readonly effort: string | null;
  readonly base: string | null;
  /** Names the worktree (branch `mend/<name>`); null derives from the session id. */
  readonly name: string | null;
  readonly ask: boolean;
  /** Priority processing — codex `service_tier=priority`. */
  readonly fast: boolean;
  /** Launch and return immediately — no attach; the session runs in the background. */
  readonly detach: boolean;
  /** Foreground semantics for this launch — the session stops when this CLI exits. */
  readonly foreground: boolean;
  /** Everything after `--` (mend run's command). */
  readonly custom: ReadonlyArray<string>;
  readonly error: string | null;
}

const LAUNCH_ERROR: Omit<LaunchArgs, "error"> = {
  project: null,
  prompt: null,
  model: null,
  effort: null,
  base: null,
  name: null,
  ask: false,
  fast: false,
  detach: false,
  foreground: false,
  custom: [],
};

/**
 * `mend claude|codex|opencode ["prompt"] [--model <id>] [--effort <level>]
 * [--base <ref>] [--ask] [--detach|-d] [--foreground] [--project <p>]`, plus
 * `mend run … -- <command...>`.
 * The first non-flag positional is the prompt; a second one is an error so a
 * forgotten quote fails loudly instead of launching with half a sentence.
 */
export const parseLaunchArgs = (args: ReadonlyArray<string>): LaunchArgs => {
  const dashdash = args.indexOf("--");
  const custom = dashdash === -1 ? [] : args.slice(dashdash + 1);
  const flagArgs = dashdash === -1 ? args : args.slice(0, dashdash);
  let project: string | null = null;
  let prompt: string | null = null;
  let model: string | null = null;
  let effort: string | null = null;
  let base: string | null = null;
  let workName: string | null = null;
  let ask = false;
  let fast = false;
  let detach = false;
  let foreground = false;
  for (let index = 0; index < flagArgs.length; index += 1) {
    const arg = flagArgs[index] ?? "";
    if (arg === "--ask") {
      ask = true;
      continue;
    }
    if (arg === "--fast") {
      fast = true;
      continue;
    }
    if (arg === "--detach" || arg === "-d") {
      detach = true;
      continue;
    }
    if (arg === "--foreground") {
      foreground = true;
      continue;
    }
    if (
      arg === "--project" ||
      arg === "--model" ||
      arg === "--effort" ||
      arg === "--base" ||
      arg === "--name"
    ) {
      const value = flagArgs[index + 1];
      if (value === undefined) return { ...LAUNCH_ERROR, error: `${arg} needs a value` };
      if (arg === "--project") project = value;
      else if (arg === "--model") model = value;
      else if (arg === "--effort") effort = value;
      else if (arg === "--name") workName = normalizeProjectName(value);
      else base = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      // Also catches a prompt starting with "-", which the harness would
      // otherwise read as a flag of its own.
      return {
        ...LAUNCH_ERROR,
        error: `unknown flag ${arg} — quote the prompt if it starts with "-"`,
      };
    }
    if (prompt !== null) {
      return {
        ...LAUNCH_ERROR,
        error: 'one prompt only — quote it: mend claude "fix the auth test"',
      };
    }
    prompt = arg;
  }
  if (effort !== null && !EFFORT_LEVELS.includes(effort)) {
    return { ...LAUNCH_ERROR, error: `--effort must be one of ${EFFORT_LEVELS.join(", ")}` };
  }
  if (detach && foreground) {
    return { ...LAUNCH_ERROR, error: "--detach and --foreground contradict — pick one" };
  }
  return {
    project,
    prompt,
    model,
    effort,
    base,
    name: workName,
    ask,
    fast,
    detach,
    foreground,
    custom,
    error: null,
  };
};

/**
 * Whether a raw stdin chunk carries the detach key (Ctrl+]). Two encodings
 * reach us: the legacy control byte 0x1d — and, once an inner TUI (claude)
 * pushes the kitty keyboard protocol through the PTY and the user's own
 * terminal honors it, the CSI-u escape `ESC [ 93 ; 5 u` (`]` is code 93,
 * ctrl is modifier 5), optionally with a kitty event-type suffix. Only press
 * (`:1`) and repeat (`:2`) are intent; a release (`:3`) is not.
 */
export const isDetachChunk = (data: Buffer): boolean => {
  if (data.includes(0x1d)) return true;
  // latin1 maps bytes 1:1, so the scan sees exactly the wire bytes. A string
  // scan rather than a regex: an escape byte inside a pattern trips lint, and
  // anchoring on the real ESC[ prefix keeps pasted text from ever matching.
  const text = data.toString("latin1");
  const prefix = "\u001b[93;5";
  for (let start = text.indexOf(prefix); start !== -1; start = text.indexOf(prefix, start + 1)) {
    const rest = text.slice(start + prefix.length);
    if (rest.startsWith("u") || rest.startsWith(":1u") || rest.startsWith(":2u")) return true;
  }
  return false;
};

/**
 * What to call a session's worktree in banners and rows: a NAMED worktree is
 * its branch minus the `mend/` prefix; an unnamed one (`mend/session/<uuid>`)
 * is called by its auto-name label, or its short id before one lands.
 */
export const sessionDisplayName = (session: {
  readonly id: string;
  readonly branch: string;
  readonly label: string | null;
}): string => {
  if (session.branch.startsWith("mend/") && !session.branch.startsWith("mend/session/")) {
    return session.branch.slice("mend/".length);
  }
  if (!session.branch.startsWith("mend/session/")) return session.branch;
  return session.label ?? `session ${session.id.slice(0, 8)}`;
};

export const LIVE_STATUSES: ReadonlySet<string> = new Set([
  "starting",
  "running",
  "waiting",
  "idle",
]);

/** The slice of a process row the CLI reasons about — the session's current agent process. */
export interface AgentProcessLike {
  readonly status: string;
  readonly exitCode: number | null;
  readonly exitedAt: string | null;
  readonly harness: string | null;
  readonly sealantSessionId: string | null;
  /** `agent-pty` · `agent-protocol` · … — optional: an older server omits it. */
  readonly kind?: string;
}

/**
 * Whether the session's AGENT is live. Session status is a fold over every process — a session
 * reads `idle` while a shell holds the workspace after its agent ended — so the agent's own row
 * answers when one exists; `starting` is a launch with no row yet.
 */
export const agentIsLive = (
  session: { readonly status: string },
  currentAgent: AgentProcessLike | null,
): boolean =>
  currentAgent === null
    ? LIVE_STATUSES.has(session.status)
    : session.status === "starting" ||
      (currentAgent.exitedAt === null &&
        (currentAgent.status === "starting" || currentAgent.status === "running"));

/** What an ended agent process's exit says about the work; null while it runs. */
export const agentOutcome = (
  currentAgent: AgentProcessLike | null,
): "completed" | "failed" | "stopped" | null => {
  if (currentAgent === null || currentAgent.exitedAt === null) return null;
  if (currentAgent.status === "stopped") return "stopped";
  if (currentAgent.harness === "shell") return "completed";
  return currentAgent.exitCode === null || currentAgent.exitCode === 0 ? "completed" : "failed";
};

export interface CwdProjectLike {
  readonly name: string;
  readonly originUrl: string | null;
}

/**
 * A git remote URL reduced to `host/owner/name` so https, ssh, scp-style, and
 * `.git` spellings of the same repository compare equal. Null for anything
 * that is not a URL-ish remote (a local path stays a path).
 */
export const normalizeRemoteUrl = (raw: string | null): string | null => {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const scp = /^(?:[^@\s/]+@)?([^:/\s]+):(?!\/)(.+)$/.exec(trimmed);
  const url = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/\s:]+)(?::\d+)?\/(.+)$/i.exec(trimmed);
  const parts = url ?? scp;
  if (parts === null) return null;
  const [, host, rest] = parts;
  if (host === undefined || rest === undefined) return null;
  const repoPath = rest.replace(/\/+$/, "").replace(/\.git$/i, "");
  return `${host.toLowerCase()}/${repoPath.toLowerCase()}`;
};

/** What the cwd says about itself — the inputs the project matcher needs. */
export interface CwdFacts {
  readonly cwd: string;
  /** `git rev-parse --show-toplevel`, or null outside a repository. */
  readonly repoRoot: string | null;
  /** `git remote get-url origin`, or null when there is none. */
  readonly originUrl: string | null;
}

/**
 * The cwd's adopted project, in order: a project adopted from this very
 * path; a project whose origin is the same remote as the cwd repo's origin
 * (normalized, so a GitHub-adopted project matches a clone of it anywhere);
 * a project named like the repository root (through the same normalization
 * adopt uses, so a checkout called "Mend" matches the project "mend").
 */
export const matchProjectByCwd = <P extends CwdProjectLike>(
  projects: ReadonlyArray<P>,
  facts: CwdFacts,
): P | undefined => {
  const root = facts.repoRoot ?? facts.cwd;
  const byPath = projects.find(
    (p) =>
      p.originUrl !== null &&
      !p.originUrl.includes("://") &&
      (root === p.originUrl ||
        facts.cwd === p.originUrl ||
        facts.cwd.startsWith(`${p.originUrl}/`)),
  );
  if (byPath !== undefined) return byPath;
  const remote = normalizeRemoteUrl(facts.originUrl);
  const byRemote =
    remote === null ? undefined : projects.find((p) => normalizeRemoteUrl(p.originUrl) === remote);
  if (byRemote !== undefined) return byRemote;
  const name = normalizeProjectName(path.basename(root));
  return projects.find((p) => p.name === name);
};

/** Read the cwd's facts from git once; callers pass them to the matcher. */
export const cwdFacts = (cwd: string): CwdFacts => ({
  cwd,
  repoRoot: gitTopLevel(cwd),
  originUrl: gitOriginUrl(cwd),
});

/** The cwd repo's origin remote, or null when there is no repo or no origin. */
export const gitOriginUrl = (cwd: string): string | null => {
  const result = spawnSync("git", ["remote", "get-url", "origin"], { cwd, encoding: "utf8" });
  const out = result.status === 0 ? result.stdout.trim() : "";
  return out === "" ? null : out;
};

/** The repository root of `cwd`, or null when it is not inside a git repo. */
export const gitTopLevel = (cwd: string): string | null => {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
};

/**
 * The store's name charset is /^[a-z0-9][a-z0-9._-]{0,63}$/ (server-enforced).
 * Derived defaults (a directory called "Mend") get normalized instead of
 * bounced; an explicit --name is sent as typed so the server's rule teaches.
 */
export const normalizeProjectName = (raw: string): string => {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+$/, "");
  return slug === "" ? "project" : slug.slice(0, 64);
};

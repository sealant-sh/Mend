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

/** A parsed `mend <harness> …` invocation; `error` set means "print and exit". */
export interface LaunchArgs {
  readonly project: string | null;
  readonly prompt: string | null;
  readonly model: string | null;
  readonly effort: string | null;
  readonly base: string | null;
  readonly ask: boolean;
  /** Priority processing — codex `service_tier=priority`. */
  readonly fast: boolean;
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
  ask: false,
  fast: false,
  custom: [],
};

/**
 * `mend claude|codex|opencode ["prompt"] [--model <id>] [--effort <level>]
 * [--base <ref>] [--ask] [--project <p>]`, plus `mend run … -- <command...>`.
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
  let ask = false;
  let fast = false;
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
    if (arg === "--project" || arg === "--model" || arg === "--effort" || arg === "--base") {
      const value = flagArgs[index + 1];
      if (value === undefined) return { ...LAUNCH_ERROR, error: `${arg} needs a value` };
      if (arg === "--project") project = value;
      else if (arg === "--model") model = value;
      else if (arg === "--effort") effort = value;
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
  return { project, prompt, model, effort, base, ask, fast, custom, error: null };
};

export const LIVE_STATUSES: ReadonlySet<string> = new Set([
  "starting",
  "running",
  "waiting",
  "idle",
]);

export interface CwdProjectLike {
  readonly name: string;
  readonly originUrl: string | null;
}

/** The cwd's adopted project: adopted-from-here first, then a basename match. */
export const matchProjectByCwd = <P extends CwdProjectLike>(
  projects: ReadonlyArray<P>,
  cwd: string,
): P | undefined => {
  const byOrigin = projects.find((p) => p.originUrl !== null && cwd.startsWith(p.originUrl));
  const byName = projects.find((p) => p.name === path.basename(cwd));
  return byOrigin ?? byName;
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

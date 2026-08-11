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

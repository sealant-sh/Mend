import { Schema } from "effect";

import { ProjectId, SkillId } from "../ids.ts";
import { Timestamp } from "../timestamp.ts";

/**
 * A skill: a named bundle of instruction files (a `SKILL.md` plus optional
 * support files) that a coding agent loads on demand. Two libraries exist —
 * the user's (identity, like dotfiles: it follows the account into every
 * project) and the project's (travels with the repository). At launch both
 * are written into the session's harness home under each harness's own
 * skills directory (`.claude/skills`, `.codex/skills`); on a name collision
 * the project's skill wins — the more specific library overrides.
 */
export const SkillScope = Schema.Literals(["user", "project"]);
export type SkillScope = typeof SkillScope.Type;

/** One file inside a skill bundle. Skills are text by contract — no binaries, no modes. */
export class SkillFile extends Schema.Class<SkillFile>("SkillFile")({
  /** Bundle-relative path, `SKILL.md` at minimum; validated by `validateSkillFilePath`. */
  path: Schema.String,
  contents: Schema.String,
}) {}

/** A skill as the libraries list it — the bundle's identity and shape, not its contents. */
export class Skill extends Schema.Class<Skill>("Skill")({
  id: SkillId,
  scope: SkillScope,
  /** The owning account when scope is `user`; null for project skills. */
  ownerUserId: Schema.NullOr(Schema.String),
  /** The owning project when scope is `project`; null for user skills. */
  projectId: Schema.NullOr(ProjectId),
  /** Also the bundle's directory name inside the harness's skills directory. */
  name: Schema.String,
  description: Schema.String,
  fileCount: Schema.Int,
  bytes: Schema.Int,
  revision: Schema.Int,
  createdAt: Timestamp,
  updatedAt: Timestamp,
}) {}

/** The full bundle — what the detail view edits and the launch path writes. */
export class SkillWithFiles extends Schema.Class<SkillWithFiles>("SkillWithFiles")({
  skill: Skill,
  files: Schema.Array(SkillFile),
}) {}

export const SKILL_MAX_NAME_LENGTH = 64;
export const SKILL_MAX_DESCRIPTION_LENGTH = 1024;
export const SKILL_MAX_FILES = 64;
export const SKILL_MAX_FILE_BYTES = 512 * 1024;
export const SKILL_MAX_BYTES = 2 * 1024 * 1024;
export const SKILL_MAX_PER_SCOPE = 200;

/** The entry file every bundle must carry — the skill's front door. */
export const SKILL_ENTRY_FILE = "SKILL.md";

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

const utf8Bytes = (value: string): number => new TextEncoder().encode(value).length;

/**
 * The name doubles as a directory name inside `$HOME/<harness>/skills`, so
 * the grammar is a safe, lowercase directory name — no separators, no dot
 * prefixes, nothing a shell needs quoted.
 */
export const validateSkillName = (name: string): string | null => {
  if (name.length === 0) return "name is required";
  if (name.length > SKILL_MAX_NAME_LENGTH) {
    return `name is longer than ${SKILL_MAX_NAME_LENGTH} characters`;
  }
  if (!SKILL_NAME_PATTERN.test(name)) {
    return "name must be lowercase letters, digits, dots, dashes or underscores, starting with a letter or digit";
  }
  return null;
};

/**
 * File paths are bundle-relative and materialized under the harness home, so
 * anything that could escape the bundle directory is rejected outright.
 */
export const validateSkillFilePath = (filePath: string): string | null => {
  if (filePath.length === 0) return "a file path is required";
  if (filePath.length > 256) return `${filePath} is longer than 256 characters`;
  if (filePath.startsWith("/") || filePath.includes("\\") || filePath.includes("\0")) {
    return `${filePath} is not a relative POSIX path`;
  }
  const segments = filePath.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return `${filePath} must not contain empty, "." or ".." segments`;
  }
  return null;
};

/** One issue that makes a whole bundle unacceptable, or null when it is well-formed. */
export const validateSkillBundle = (input: {
  readonly name: string;
  readonly description: string;
  readonly files: ReadonlyArray<{ readonly path: string; readonly contents: string }>;
}): string | null => {
  const nameIssue = validateSkillName(input.name);
  if (nameIssue !== null) return nameIssue;
  if (input.description.length > SKILL_MAX_DESCRIPTION_LENGTH) {
    return `description is longer than ${SKILL_MAX_DESCRIPTION_LENGTH} characters`;
  }
  if (input.files.length === 0) return `a skill needs at least its ${SKILL_ENTRY_FILE}`;
  if (input.files.length > SKILL_MAX_FILES) {
    return `a skill is capped at ${SKILL_MAX_FILES} files`;
  }
  if (!input.files.some((file) => file.path === SKILL_ENTRY_FILE)) {
    return `a skill must carry a top-level ${SKILL_ENTRY_FILE}`;
  }
  const seen = new Set<string>();
  let total = 0;
  for (const file of input.files) {
    const pathIssue = validateSkillFilePath(file.path);
    if (pathIssue !== null) return pathIssue;
    if (seen.has(file.path)) return `${file.path} appears twice`;
    seen.add(file.path);
    const bytes = utf8Bytes(file.contents);
    if (bytes > SKILL_MAX_FILE_BYTES) {
      return `${file.path} is over ${SKILL_MAX_FILE_BYTES / 1024}KB — skills are text; trim it`;
    }
    total += bytes;
  }
  if (total > SKILL_MAX_BYTES) {
    return `the bundle is over ${SKILL_MAX_BYTES / (1024 * 1024)}MB in total`;
  }
  return null;
};

/** Total decoded size of a bundle's files, the number the caps above meter. */
export const skillBundleBytes = (files: ReadonlyArray<{ readonly contents: string }>): number =>
  files.reduce((sum, file) => sum + utf8Bytes(file.contents), 0);

import { Schema } from "effect";

import { ReferenceId, Sha } from "../ids.ts";
import { Timestamp } from "../timestamp.ts";

/**
 * An upstream repository cloned into the store as read-only source material —
 * dependency sources the agent should read instead of guessing APIs (plan §17,
 * decided 2026-08-01). Not a project: no sessions, no worktrees, no adoption.
 * One global list; each project selects which references its sessions mount at
 * `/workspace/ref/<name>`.
 */
export class Reference extends Schema.Class<Reference>("Reference")({
  id: ReferenceId,
  /** Short name; also the clone directory and the mount directory name. */
  name: Schema.String,
  /** Where the clone comes from — a remote URL or a local path. */
  originUrl: Schema.String,
  /** Absolute path of the clone inside the store: `<storeRoot>/_references/<name>`. */
  path: Schema.String,
  /** Branch or tag the clone is held at; null = the remote's default branch. */
  pinnedRef: Schema.NullOr(Schema.String),
  /** HEAD of the clone as last observed — what sessions launched now would see. */
  headSha: Schema.NullOr(Sha),
  refreshedAt: Schema.NullOr(Timestamp),
  createdAt: Timestamp,
  updatedAt: Timestamp,
}) {}

/**
 * What a session actually received: one reference as mounted at launch, with
 * the SHA observed then — the session record stays honest even after the
 * clone refreshes.
 */
export class SessionReferenceMount extends Schema.Class<SessionReferenceMount>(
  "SessionReferenceMount",
)({
  name: Schema.String,
  /** Container path the clone was mounted at, e.g. `/workspace/ref/effect`. */
  mountPath: Schema.String,
  sha: Schema.NullOr(Sha),
}) {}

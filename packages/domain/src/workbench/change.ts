import { Schema } from "effect";

import { ChangeId, ProjectId, SessionId, Sha } from "../ids.ts";

/**
 * The reviewable object (plan §5.6): the session worktree against its base.
 * One change per session; because every write in a worktree happens through a
 * supervised workspace, evidence attribution is structural. Git remains the
 * source of truth for the comparison — this row carries identity and the
 * facts worth indexing, never the diff itself. Landing the change (merging
 * the session branch) belongs to publication.
 */
export class Change extends Schema.Class<Change>("WorkbenchChange")({
  id: ChangeId,
  projectId: ProjectId,
  sessionId: SessionId,
  /** The session branch the worktree is on. */
  branch: Schema.String,
  /** The comparison base — where the worktree branched from. */
  baseSha: Sha,
  /** Last observed worktree head; refreshed opportunistically, never authoritative. */
  headSha: Schema.NullOr(Sha),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {}

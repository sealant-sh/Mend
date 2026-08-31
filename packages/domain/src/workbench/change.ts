import { Schema } from "effect";

import { ChangeId, ProjectId, SessionId, Sha, WorktreeId } from "../ids.ts";
import { Timestamp } from "../timestamp.ts";

/**
 * The reviewable object (plan §5.6): the worktree against its base. One
 * change per worktree; every session that runs inside the worktree
 * contributes to the same change, and because every write happens through a
 * supervised workspace, evidence attribution is structural. Git remains the
 * source of truth for the comparison — this row carries identity and the
 * facts worth indexing, never the diff itself. Landing the change (merging
 * the worktree branch) belongs to publication.
 */
export class Change extends Schema.Class<Change>("WorkbenchChange")({
  id: ChangeId,
  projectId: ProjectId,
  worktreeId: WorktreeId,
  /**
   * The last contributing session — a maintained mirror for pre-worktree
   * clients, stamped on every head refresh. Null only for a worktree no
   * session has ever inhabited. New readers should address sessions through
   * the worktree instead.
   */
  sessionId: Schema.NullOr(SessionId),
  /** The branch the worktree is on. */
  branch: Schema.String,
  /** The comparison base — where the worktree branched from. */
  baseSha: Sha,
  /** Last observed worktree head; refreshed opportunistically, never authoritative. */
  headSha: Schema.NullOr(Sha),
  createdAt: Timestamp,
  updatedAt: Timestamp,
}) {}

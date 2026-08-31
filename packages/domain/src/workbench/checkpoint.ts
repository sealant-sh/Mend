import { Schema } from "effect";

import { CheckpointId, SealantRunId, SessionId, Sha, WorktreeId } from "../ids.ts";
import { SequenceNumber, Timestamp } from "../timestamp.ts";

/** What caused a checkpoint to be taken (plan §5.6 "Checkpoints and slices"). */
export const CheckpointTrigger = Schema.Literals([
  "session-start",
  "command-settle",
  "turn-boundary",
  "review-open",
  "user-mark",
]);
export type CheckpointTrigger = typeof CheckpointTrigger.Type;

/**
 * A cheap snapshot of the worktree — a commit on a hidden ref that never
 * touches the visible branch — stamped with the exact record pointer current when it was
 * taken. The `(ref, sealantRunId, seq)` tuple joins the two truths: git carries what changed, the
 * record carries why. Sequence numbers restart for every Sealant run. The chain belongs to the
 * worktree: checkpoints from every session in it share one ordinal sequence, and any two define
 * a reviewable slice.
 */
export class Checkpoint extends Schema.Class<Checkpoint>("Checkpoint")({
  id: CheckpointId,
  worktreeId: WorktreeId,
  /**
   * Provenance: the conversation whose activity triggered the snapshot. Null
   * for worktree-level triggers (the worktree-start checkpoint, review opened
   * with no live session) and for checkpoints whose session was deleted.
   */
  sessionId: Schema.NullOr(SessionId),
  /** Position in the worktree's chain, dense from 0 (the worktree-start checkpoint). */
  ordinal: Schema.Int,
  /**
   * Hidden ref: `refs/mend/checkpoints/<worktreeId>/<ordinal>` for new rows;
   * legacy rows keep their stored session-scoped refs, which stay resolvable.
   */
  ref: Schema.String,
  sha: Sha,
  /** Null only before the session's first platform run, or on honest legacy gaps. */
  sealantRunId: Schema.NullOr(SealantRunId),
  /** Record sequence the supervisor had seen when the snapshot was taken. */
  seq: SequenceNumber,
  trigger: CheckpointTrigger,
  createdAt: Timestamp,
}) {}

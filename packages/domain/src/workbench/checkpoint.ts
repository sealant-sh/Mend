import { Schema } from "effect";

import { CheckpointId, SealantRunId, SessionId, Sha } from "../ids.ts";

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
 * A cheap snapshot of the session worktree — a commit on a hidden ref that
 * never touches the visible branch — stamped with the exact record pointer current when it was
 * taken. The `(ref, sealantRunId, seq)` tuple joins the two truths: git carries what changed, the
 * record carries why. Sequence numbers restart for every Sealant run.
 */
export class Checkpoint extends Schema.Class<Checkpoint>("Checkpoint")({
  id: CheckpointId,
  sessionId: SessionId,
  /** Hidden ref: `refs/mend/checkpoints/<sessionId>/<n>`. */
  ref: Schema.String,
  sha: Sha,
  /** Null only before the session's first platform run, or on honest legacy gaps. */
  sealantRunId: Schema.NullOr(SealantRunId),
  /** Record sequence the supervisor had seen when the snapshot was taken. */
  seq: Schema.BigInt,
  trigger: CheckpointTrigger,
  createdAt: Schema.Date,
}) {}

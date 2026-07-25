import { Schema } from "effect";

import { CheckpointId, SessionId, Sha } from "../ids.ts";

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
 * never touches the visible branch — stamped with the record sequence current
 * when it was taken. The `(ref, seq)` pair joins the two truths: git carries
 * what changed, the record carries why. Any two checkpoints define a
 * reviewable slice: `refA..refB` for the diff, `seqA..seqB` for the evidence.
 */
export class Checkpoint extends Schema.Class<Checkpoint>("Checkpoint")({
  id: CheckpointId,
  sessionId: SessionId,
  /** Hidden ref: `refs/mend/checkpoints/<sessionId>/<n>`. */
  ref: Schema.String,
  sha: Sha,
  /** Record sequence the supervisor had seen when the snapshot was taken. */
  seq: Schema.BigInt,
  trigger: CheckpointTrigger,
  createdAt: Schema.Date,
}) {}

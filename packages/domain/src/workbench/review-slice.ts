import { Schema } from "effect";

import { ChangeId, CheckpointId, ReviewSliceId } from "../ids.ts";

/** SHA-256 of the exact unified patch bytes returned for a Review slice. */
export const DiffDigest = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  Schema.brand("DiffDigest"),
);
export type DiffDigest = typeof DiffDigest.Type;

/**
 * An immutable Review comparison. Both checkpoint refs point at hidden git commits; the digest
 * binds clients, comments, and follow-ups to the exact patch transported for this comparison.
 */
export class ReviewSlice extends Schema.Class<ReviewSlice>("ReviewSlice")({
  id: ReviewSliceId,
  changeId: ChangeId,
  checkpointAId: CheckpointId,
  checkpointBId: CheckpointId,
  diffDigest: DiffDigest,
  createdAt: Schema.Date,
}) {}

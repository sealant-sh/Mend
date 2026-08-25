import { Schema } from "effect";

import { ChangeId, CheckpointId, ReviewCommentId, ReviewSliceId, SessionId } from "../ids.ts";
import { Timestamp } from "../timestamp.ts";
import { DiffDigest } from "./review-slice.ts";

/** Who wrote it: the human reviewer, or Mend ("Mend reads the change", §7.3). */
export const CommentAuthor = Schema.Literals(["reviewer", "mend"]);
export type CommentAuthor = typeof CommentAuthor.Type;

/**
 * `draft` exists only for Mend-authored findings awaiting accept/dismiss —
 * a reviewer's comment is born `open`. `addressed` is set when a follow-up
 * settles and the anchored hunk changed; it is an observation, not a verdict.
 */
export const CommentState = Schema.Literals(["draft", "open", "addressed", "dismissed"]);
export type CommentState = typeof CommentState.Type;

/**
 * A finding's link back to the session record: `(sealantRunId, sequence)`
 * addresses the exact timeline entry; the excerpt is denormalized so the
 * comment renders without a platform round-trip. The workbench analogue of
 * the queue-era EvidencePointer — sessions are backed by platform runs, so
 * the run id here is the platform's, not a Mend row id.
 */
export class RecordLink extends Schema.Class<RecordLink>("RecordLink")({
  sealantRunId: Schema.String,
  // BigInt in the domain, a decimal string on every wire — sequences can
  // pass 2^53 and JSON has no bigint.
  sequence: Schema.BigIntFromString,
  excerpt: Schema.String,
}) {}

/**
 * What the comment is: a `note` states an observation; a `suggestion` also
 * carries a concrete replacement for the anchored lines (the suggestion
 * pass's output — strict by contract, accepted or dismissed like any draft).
 */
export const CommentKind = Schema.Literals(["note", "suggestion"]);
export type CommentKind = typeof CommentKind.Type;

export const ReviewAnchorSide = Schema.Literals(["old", "new"]);
export type ReviewAnchorSide = typeof ReviewAnchorSide.Type;

export const ReviewAnchorMapping = Schema.Literals(["anchored", "moved", "not-found"]);
export type ReviewAnchorMapping = typeof ReviewAnchorMapping.Type;

/**
 * A comment target bound to one immutable Review slice. Null paths and lines represent a
 * change-level target; paths with null lines represent a file-level target. The hunk context hash
 * makes line anchors fail visibly instead of silently drifting when clients map them later.
 */
export class ReviewCommentAnchor extends Schema.Class<ReviewCommentAnchor>("ReviewCommentAnchor")({
  reviewSliceId: ReviewSliceId,
  checkpointAId: CheckpointId,
  checkpointBId: CheckpointId,
  diffDigest: DiffDigest,
  oldPath: Schema.NullOr(Schema.String),
  newPath: Schema.NullOr(Schema.String),
  side: Schema.NullOr(ReviewAnchorSide),
  startLine: Schema.NullOr(Schema.Int),
  endLine: Schema.NullOr(Schema.Int),
  hunkContextHash: Schema.NullOr(Schema.String),
  mapping: ReviewAnchorMapping,
}) {}

/**
 * Feedback anchored to a file, line, or the change as a whole (plan §5.7).
 * `file`/`line` null = change-level. Comments can stay notes, or be bundled
 * into a follow-up instruction and sent back to the session — the routed
 * decision is recorded on the comment that caused it.
 */
export class ReviewComment extends Schema.Class<ReviewComment>("ReviewComment")({
  id: ReviewCommentId,
  changeId: ChangeId,
  /** Anchor: null file = change-level; null line = file-level. */
  file: Schema.NullOr(Schema.String),
  line: Schema.NullOr(Schema.Int),
  /** Inclusive range end; null = the comment anchors to `line` alone. */
  endLine: Schema.NullOr(Schema.Int),
  /** Null marks an honest legacy live-diff anchor. New reviewer comments always set this. */
  anchor: Schema.NullOr(ReviewCommentAnchor),
  authorKind: CommentAuthor,
  authorName: Schema.String,
  body: Schema.String,
  kind: CommentKind,
  /** The proposed replacement for the anchored lines — set only when kind is `suggestion`. */
  suggestion: Schema.NullOr(Schema.String),
  state: CommentState,
  /**
   * Links to the session record — non-empty on every record-grounded finding.
   * Suggestions are readings of the diff itself; theirs may be empty, and the
   * empty list is the honest "inferred reading" marker, never an omission.
   */
  evidence: Schema.Array(RecordLink),
  /** The session a bundled follow-up was sent to, once sent. */
  sentToSessionId: Schema.NullOr(SessionId),
  createdAt: Timestamp,
  updatedAt: Timestamp,
}) {}

import { Schema } from "effect";

import { ChangeId, ReviewCommentId, SessionId } from "../ids.ts";

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
  authorKind: CommentAuthor,
  authorName: Schema.String,
  body: Schema.String,
  state: CommentState,
  /** The session a bundled follow-up was sent to, once sent. */
  sentToSessionId: Schema.NullOr(SessionId),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {}

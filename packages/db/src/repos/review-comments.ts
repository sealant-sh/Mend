import { PgClient } from "@effect/sql-pg";
import { type ChangeId, ReviewCommentId, type SessionId } from "@mend/domain";
import { ReviewComment, type CommentAuthor, type CommentState } from "@mend/domain/workbench";
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

import { notifyEvent } from "../events.ts";

export class ReviewCommentNotFoundError extends Schema.TaggedErrorClass<ReviewCommentNotFoundError>()(
  "ReviewCommentNotFoundError",
  {
    commentId: Schema.String,
  },
) {}

const decodeComment = Schema.decodeUnknownEffect(Schema.Struct(ReviewComment.fields));

export interface NewReviewComment {
  readonly changeId: ChangeId;
  readonly file: string | null;
  readonly line: number | null;
  readonly endLine: number | null;
  readonly authorKind: CommentAuthor;
  readonly authorName: string;
  readonly body: string;
  /** Reviewer comments are born `open`; Mend's findings are born `draft` (§7.3). */
  readonly state: CommentState;
}

/** Review comments on a session change (plan §5.7) — reviewer's and Mend's, one pipeline. */
export class ReviewCommentsRepo extends Context.Service<
  ReviewCommentsRepo,
  {
    readonly create: (comment: NewReviewComment) => Effect.Effect<ReviewComment>;
    readonly byId: (
      id: ReviewCommentId,
    ) => Effect.Effect<ReviewComment, ReviewCommentNotFoundError>;
    readonly listForChange: (changeId: ChangeId) => Effect.Effect<ReadonlyArray<ReviewComment>>;
    readonly setState: (id: ReviewCommentId, state: CommentState) => Effect.Effect<void>;
    /** Records which session a bundled follow-up carrying this comment went to. */
    readonly markSent: (id: ReviewCommentId, sessionId: SessionId) => Effect.Effect<void>;
  }
>()("@mend/db/ReviewCommentsRepo") {
  static readonly layer = Layer.effect(
    ReviewCommentsRepo,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;

      const decodeRow = (row: unknown) =>
        decodeComment(row).pipe(
          Effect.map((decoded) => new ReviewComment(decoded)),
          Effect.orDie,
        );

      const notify = (id: ReviewCommentId, changeId: ChangeId) =>
        sql`SELECT project_id FROM session_changes WHERE id = ${changeId}`.pipe(
          Effect.orDie,
          Effect.flatMap((rows) => {
            const row = rows[0] as { projectId: string } | undefined;
            return notifyEvent(sql, {
              type: "review-comment",
              commentId: id,
              changeId,
              projectId: row?.projectId ?? "",
            });
          }),
        );

      const create = Effect.fn("ReviewCommentsRepo.create")(function* (comment: NewReviewComment) {
        const id = crypto.randomUUID();
        const rows = yield* sql`
          INSERT INTO review_comments (id, change_id, file, line, end_line, author_kind, author_name, body, state)
          VALUES (${id}, ${comment.changeId}, ${comment.file}, ${comment.line}, ${comment.endLine},
                  ${comment.authorKind}, ${comment.authorName}, ${comment.body}, ${comment.state})
          RETURNING *`.pipe(Effect.orDie);
        const created = yield* decodeRow(rows[0]);
        yield* notify(created.id, comment.changeId);
        return created;
      });

      const byId = Effect.fn("ReviewCommentsRepo.byId")(function* (id: ReviewCommentId) {
        const rows = yield* sql`SELECT * FROM review_comments WHERE id = ${id}`.pipe(Effect.orDie);
        const row = rows[0];
        if (row === undefined) return yield* new ReviewCommentNotFoundError({ commentId: id });
        return yield* decodeRow(row);
      });

      const listForChange = Effect.fn("ReviewCommentsRepo.listForChange")(function* (
        changeId: ChangeId,
      ) {
        const rows = yield* sql`
          SELECT * FROM review_comments WHERE change_id = ${changeId}
          ORDER BY created_at ASC`.pipe(Effect.orDie);
        return yield* Effect.forEach(rows, decodeRow);
      });

      const setState = Effect.fn("ReviewCommentsRepo.setState")(function* (
        id: ReviewCommentId,
        state: CommentState,
      ) {
        const rows = yield* sql`
          UPDATE review_comments SET state = ${state}, updated_at = now()
          WHERE id = ${id}
          RETURNING change_id`.pipe(Effect.orDie);
        const row = rows[0] as { changeId: ChangeId } | undefined;
        if (row !== undefined) yield* notify(id, row.changeId);
      });

      const markSent = Effect.fn("ReviewCommentsRepo.markSent")(function* (
        id: ReviewCommentId,
        sessionId: SessionId,
      ) {
        yield* sql`
          UPDATE review_comments SET sent_to_session_id = ${sessionId}, updated_at = now()
          WHERE id = ${id}`.pipe(Effect.orDie);
      });

      return { create, byId, listForChange, setState, markSent };
    }),
  );
}

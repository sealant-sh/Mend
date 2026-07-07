import { PgClient } from "@effect/sql-pg";
import {
  BriefComment,
  BriefCommentId,
  type BriefId,
  type CommentAuthorKind,
  type RoutedAction,
  type RunId,
} from "@mend/domain";
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

import { notifyEvent } from "../events.ts";

export class BriefCommentNotFoundError extends Schema.TaggedErrorClass<BriefCommentNotFoundError>()(
  "BriefCommentNotFoundError",
  {
    commentId: Schema.String,
  },
) {}

const decodeComment = Schema.decodeUnknownEffect(BriefComment);

/** The review conversation on a brief — reviewer entries and Mend's replies. */
export class BriefCommentsRepo extends Context.Service<
  BriefCommentsRepo,
  {
    readonly create: (input: {
      readonly briefId: BriefId;
      readonly thread: string;
      readonly authorKind: CommentAuthorKind;
      readonly authorName: string;
      readonly body: string;
    }) => Effect.Effect<BriefComment>;
    readonly byId: (id: BriefCommentId) => Effect.Effect<BriefComment, BriefCommentNotFoundError>;
    readonly listForBrief: (briefId: BriefId) => Effect.Effect<ReadonlyArray<BriefComment>>;
    /** Records what Mend decided the comment asks for — the routing, as evidence. */
    readonly setRouted: (
      id: BriefCommentId,
      action: RoutedAction,
      runId: RunId | null,
    ) => Effect.Effect<void>;
  }
>()("@mend/db/BriefCommentsRepo") {
  static readonly layer = Layer.effect(
    BriefCommentsRepo,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;

      const decodeRow = (row: unknown) =>
        decodeComment(row).pipe(
          Effect.map((decoded) => new BriefComment(decoded)),
          Effect.orDie,
        );

      const notify = (briefId: BriefId) =>
        Effect.gen(function* () {
          const rows = yield* sql`
            SELECT c.issue_id AS issue_id FROM changes c
            JOIN briefs b ON b.change_id = c.id
            WHERE b.id = ${briefId}`.pipe(Effect.orDie);
          const row = rows[0] as { issueId: string } | undefined;
          yield* notifyEvent(sql, {
            type: "brief-comment",
            briefId,
            issueId: row?.issueId ?? "",
          });
        });

      const create = Effect.fn("BriefCommentsRepo.create")(function* (input: {
        readonly briefId: BriefId;
        readonly thread: string;
        readonly authorKind: CommentAuthorKind;
        readonly authorName: string;
        readonly body: string;
      }) {
        const id = crypto.randomUUID();
        const rows = yield* sql`
          INSERT INTO brief_comments (id, brief_id, thread, author_kind, author_name, body)
          VALUES (${id}, ${input.briefId}, ${input.thread}, ${input.authorKind}, ${input.authorName}, ${input.body})
          RETURNING *`.pipe(Effect.orDie);
        const comment = yield* decodeRow(rows[0]);
        yield* notify(input.briefId);
        return comment;
      });

      const byId = Effect.fn("BriefCommentsRepo.byId")(function* (id: BriefCommentId) {
        const rows = yield* sql`SELECT * FROM brief_comments WHERE id = ${id}`.pipe(Effect.orDie);
        const row = rows[0];
        if (row === undefined) return yield* new BriefCommentNotFoundError({ commentId: id });
        return yield* decodeRow(row);
      });

      const listForBrief = Effect.fn("BriefCommentsRepo.listForBrief")(function* (
        briefId: BriefId,
      ) {
        const rows = yield* sql`
          SELECT * FROM brief_comments WHERE brief_id = ${briefId}
          ORDER BY created_at ASC`.pipe(Effect.orDie);
        return yield* Effect.forEach(rows, decodeRow);
      });

      const setRouted = Effect.fn("BriefCommentsRepo.setRouted")(function* (
        id: BriefCommentId,
        action: RoutedAction,
        runId: RunId | null,
      ) {
        yield* sql`
          UPDATE brief_comments SET routed_action = ${action}, routed_run_id = ${runId}
          WHERE id = ${id}`.pipe(Effect.orDie);
        const rows = yield* sql`SELECT brief_id FROM brief_comments WHERE id = ${id}`.pipe(
          Effect.orDie,
        );
        const row = rows[0] as { briefId: BriefId } | undefined;
        if (row !== undefined) yield* notify(row.briefId);
      });

      return { create, byId, listForBrief, setRouted };
    }),
  );
}

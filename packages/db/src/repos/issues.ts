import { PgClient } from "@effect/sql-pg";
import { Issue, IssueId, IssueSource, type IssueStage, type RunId } from "@mend/domain";
import { Effect, Layer, Option, Schema } from "effect";
import * as Context from "effect/Context";

import { IssueNotFoundError } from "../errors.ts";
import { notifyEvent } from "../events.ts";

/** Manual entry is just another intake; tracker layers arrive with M5. */
export class NewIssue extends Schema.Class<NewIssue>("NewIssue")({
  source: IssueSource,
  externalRef: Schema.NullOr(Schema.String),
  repository: Schema.String,
  title: Schema.String,
  body: Schema.String,
}) {}

/**
 * The moves a person can make on the board — Gate 1 and its undo. Everything
 * else (mending, review, merged) is the product's to set, never the drag's.
 */
export class QueueMove extends Schema.Class<QueueMove>("QueueMove")({
  stage: Schema.Literals(["triage", "queued"]),
  /** Target index within queued, 0 = top. Appends when null. */
  position: Schema.NullOr(Schema.Int),
}) {}

const decodeIssue = Schema.decodeUnknownEffect(Issue);

export class IssuesRepo extends Context.Service<
  IssuesRepo,
  {
    /** New issues land in triage. Mend does nothing with an issue sitting there. */
    readonly create: (input: NewIssue) => Effect.Effect<Issue>;
    readonly list: () => Effect.Effect<ReadonlyArray<Issue>>;
    readonly byId: (id: IssueId) => Effect.Effect<Issue, IssueNotFoundError>;
    /** Gate 1: the human drag — into the queue, out of it, or reordering it. */
    readonly move: (id: IssueId, move: QueueMove) => Effect.Effect<Issue, IssueNotFoundError>;
    /** The dispatcher takes the top of the queue into mending. */
    readonly markMending: (id: IssueId) => Effect.Effect<Issue, IssueNotFoundError>;
    /** A successful run puts the card in review. */
    readonly markReview: (id: IssueId) => Effect.Effect<Issue, IssueNotFoundError>;
    /** A failed run returns the card to triage carrying the failure. */
    readonly returnToTriage: (
      id: IssueId,
      failureRunId: RunId,
    ) => Effect.Effect<Issue, IssueNotFoundError>;
    /** The user-visible queue is domain state: `stage = queued` ordered by `position`. */
    readonly topOfQueued: () => Effect.Effect<Option.Option<Issue>>;
    readonly countByStage: (stage: IssueStage) => Effect.Effect<number>;
  }
>()("@mend/db/IssuesRepo") {
  static readonly layer = Layer.effect(
    IssuesRepo,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;

      const decodeRow = (row: unknown) => decodeIssue(row).pipe(Effect.orDie);

      const updateStage = Effect.fn("IssuesRepo.updateStage")(function* (
        id: IssueId,
        stage: IssueStage,
        options?: { readonly failureRunId?: RunId },
      ) {
        const failureRunId = options?.failureRunId ?? null;
        const rows = yield* sql`
          UPDATE issues
          SET stage = ${stage},
              position = NULL,
              last_failure_run_id = COALESCE(${failureRunId}, last_failure_run_id),
              updated_at = now()
          WHERE id = ${id}
          RETURNING *`.pipe(Effect.orDie);
        const row = rows[0];
        if (row === undefined) return yield* new IssueNotFoundError({ issueId: id });
        const issue = yield* decodeRow(row);
        yield* notifyEvent(sql, { type: "issue", issueId: id });
        return issue;
      });

      /** Renumbers the queue with `id` at `index` (appends when null). */
      const placeInQueue = Effect.fn("IssuesRepo.placeInQueue")(function* (
        id: IssueId,
        index: number | null,
      ) {
        return yield* sql
          .withTransaction(
            Effect.gen(function* () {
              const exists = yield* sql`SELECT id FROM issues WHERE id = ${id} FOR UPDATE`.pipe(
                Effect.orDie,
              );
              if (exists.length === 0) return yield* new IssueNotFoundError({ issueId: id });

              const rows = yield* sql`
              SELECT id FROM issues WHERE stage = 'queued' AND id <> ${id}
              ORDER BY position ASC NULLS LAST, updated_at ASC
              FOR UPDATE`.pipe(Effect.orDie);
              const others = rows.map((row) => (row as { id: string }).id);
              const at =
                index === null ? others.length : Math.max(0, Math.min(index, others.length));
              const ordered = [...others.slice(0, at), id, ...others.slice(at)];

              for (const [position, issueId] of ordered.entries()) {
                yield* sql`
                UPDATE issues
                SET stage = 'queued', position = ${position}, updated_at = now()
                WHERE id = ${issueId}`.pipe(Effect.orDie);
              }

              const updated = yield* sql`SELECT * FROM issues WHERE id = ${id}`.pipe(Effect.orDie);
              return yield* decodeRow(updated[0]);
            }),
          )
          .pipe(
            Effect.catch((error) =>
              error._tag === "IssueNotFoundError" ? Effect.fail(error) : Effect.die(error),
            ),
            Effect.tap(() => notifyEvent(sql, { type: "issue", issueId: id })),
          );
      });

      const create = Effect.fn("IssuesRepo.create")(function* (input: NewIssue) {
        const id = crypto.randomUUID();
        const rows = yield* sql`
          INSERT INTO issues (id, source, external_ref, repository, title, body)
          VALUES (${id}, ${input.source}, ${input.externalRef}, ${input.repository}, ${input.title}, ${input.body})
          RETURNING *`.pipe(Effect.orDie);
        const issue = yield* decodeRow(rows[0]);
        yield* notifyEvent(sql, { type: "issue", issueId: issue.id });
        return issue;
      });

      const list = Effect.fn("IssuesRepo.list")(function* () {
        const rows = yield* sql`
          SELECT * FROM issues
          ORDER BY position ASC NULLS LAST, created_at DESC`.pipe(Effect.orDie);
        return yield* Effect.forEach(rows, decodeRow);
      });

      const byId = Effect.fn("IssuesRepo.byId")(function* (id: IssueId) {
        const rows = yield* sql`SELECT * FROM issues WHERE id = ${id}`.pipe(Effect.orDie);
        const row = rows[0];
        if (row === undefined) return yield* new IssueNotFoundError({ issueId: id });
        return yield* decodeRow(row);
      });

      const move = Effect.fn("IssuesRepo.move")(function* (id: IssueId, queueMove: QueueMove) {
        if (queueMove.stage === "queued") return yield* placeInQueue(id, queueMove.position);
        return yield* updateStage(id, "triage");
      });

      const markMending = Effect.fn("IssuesRepo.markMending")((id: IssueId) =>
        updateStage(id, "mending"),
      );

      const markReview = Effect.fn("IssuesRepo.markReview")((id: IssueId) =>
        updateStage(id, "review"),
      );

      const returnToTriage = Effect.fn("IssuesRepo.returnToTriage")(
        (id: IssueId, failureRunId: RunId) => updateStage(id, "triage", { failureRunId }),
      );

      const topOfQueued = Effect.fn("IssuesRepo.topOfQueued")(function* () {
        const rows = yield* sql`
          SELECT * FROM issues WHERE stage = 'queued'
          ORDER BY position ASC NULLS LAST, created_at ASC
          LIMIT 1`.pipe(Effect.orDie);
        const row = rows[0];
        if (row === undefined) return Option.none<Issue>();
        return Option.some(yield* decodeRow(row));
      });

      const countByStage = Effect.fn("IssuesRepo.countByStage")(function* (stage: IssueStage) {
        const rows = yield* sql`
          SELECT count(*)::int AS count FROM issues WHERE stage = ${stage}`.pipe(Effect.orDie);
        const row = rows[0] as { count: number } | undefined;
        return row?.count ?? 0;
      });

      return {
        create,
        list,
        byId,
        move,
        markMending,
        markReview,
        returnToTriage,
        topOfQueued,
        countByStage,
      };
    }),
  );
}

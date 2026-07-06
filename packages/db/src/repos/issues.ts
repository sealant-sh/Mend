import { PgClient } from "@effect/sql-pg";
import { Issue, IssueId, IssueSource, type IssueStage } from "@mend/domain";
import { Effect, Layer, Option, Schema } from "effect";
import * as Context from "effect/Context";

import { IssueNotFoundError } from "../errors.ts";

/** Manual entry is just another intake; tracker layers arrive with M5. */
export class NewIssue extends Schema.Class<NewIssue>("NewIssue")({
  source: IssueSource,
  externalRef: Schema.NullOr(Schema.String),
  repository: Schema.String,
  title: Schema.String,
  body: Schema.String,
}) {}

const decodeIssue = Schema.decodeUnknownEffect(Issue);

export class IssuesRepo extends Context.Service<
  IssuesRepo,
  {
    /** New issues land in triage. Mend does nothing with an issue sitting there. */
    readonly create: (input: NewIssue) => Effect.Effect<Issue>;
    readonly list: () => Effect.Effect<ReadonlyArray<Issue>>;
    readonly byId: (id: IssueId) => Effect.Effect<Issue, IssueNotFoundError>;
    readonly setStage: (id: IssueId, stage: IssueStage) => Effect.Effect<Issue, IssueNotFoundError>;
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

      const create = Effect.fn("IssuesRepo.create")(function* (input: NewIssue) {
        const id = crypto.randomUUID();
        const rows = yield* sql`
          INSERT INTO issues (id, source, external_ref, repository, title, body)
          VALUES (${id}, ${input.source}, ${input.externalRef}, ${input.repository}, ${input.title}, ${input.body})
          RETURNING *`.pipe(Effect.orDie);
        return yield* decodeRow(rows[0]);
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

      const setStage = Effect.fn("IssuesRepo.setStage")(function* (id: IssueId, stage: IssueStage) {
        const rows = yield* sql`
          UPDATE issues SET stage = ${stage}, updated_at = now()
          WHERE id = ${id}
          RETURNING *`.pipe(Effect.orDie);
        const row = rows[0];
        if (row === undefined) return yield* new IssueNotFoundError({ issueId: id });
        return yield* decodeRow(row);
      });

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

      return { create, list, byId, setStage, topOfQueued, countByStage };
    }),
  );
}

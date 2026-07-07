import { PgClient } from "@effect/sql-pg";
import { Change, ChangeId, type IssueId, type Sha } from "@mend/domain";
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

export class ChangeNotFoundError extends Schema.TaggedErrorClass<ChangeNotFoundError>()(
  "ChangeNotFoundError",
  {
    id: Schema.String,
  },
) {}

const decodeChange = Schema.decodeUnknownEffect(Change);

/**
 * The change is one per issue (ARCHITECTURE.md §3): one branch, at most one PR
 * carrying it. It appears with the first completed run and is the anchor the
 * living brief hangs off.
 */
export class ChangesRepo extends Context.Service<
  ChangesRepo,
  {
    /**
     * The issue's change, created on first call. Head facts are refreshed on
     * every call — each completed run moves the head the evidence describes.
     */
    readonly ensureForIssue: (
      issueId: IssueId,
      facts: {
        readonly branch: string;
        readonly baseSha: Sha | null;
        readonly headSha: Sha | null;
      },
    ) => Effect.Effect<Change>;
    readonly byId: (id: ChangeId) => Effect.Effect<Change, ChangeNotFoundError>;
    readonly byIssue: (issueId: IssueId) => Effect.Effect<Change, ChangeNotFoundError>;
  }
>()("@mend/db/ChangesRepo") {
  static readonly layer = Layer.effect(
    ChangesRepo,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;

      const decodeRow = (row: unknown) =>
        decodeChange(row).pipe(
          Effect.map((decoded) => new Change(decoded)),
          Effect.orDie,
        );

      const ensureForIssue = Effect.fn("ChangesRepo.ensureForIssue")(function* (
        issueId: IssueId,
        facts: {
          readonly branch: string;
          readonly baseSha: Sha | null;
          readonly headSha: Sha | null;
        },
      ) {
        const id = crypto.randomUUID();
        const rows = yield* sql`
          INSERT INTO changes (id, issue_id, branch, base_sha, head_sha)
          VALUES (${id}, ${issueId}, ${facts.branch}, ${facts.baseSha}, ${facts.headSha})
          ON CONFLICT (issue_id) DO UPDATE
          SET branch = CASE WHEN EXCLUDED.branch = '' THEN changes.branch ELSE EXCLUDED.branch END,
              base_sha = COALESCE(changes.base_sha, EXCLUDED.base_sha),
              head_sha = COALESCE(EXCLUDED.head_sha, changes.head_sha),
              updated_at = now()
          RETURNING *`.pipe(Effect.orDie);
        return yield* decodeRow(rows[0]);
      });

      const byId = Effect.fn("ChangesRepo.byId")(function* (id: ChangeId) {
        const rows = yield* sql`SELECT * FROM changes WHERE id = ${id}`.pipe(Effect.orDie);
        const row = rows[0];
        if (row === undefined) return yield* new ChangeNotFoundError({ id });
        return yield* decodeRow(row);
      });

      const byIssue = Effect.fn("ChangesRepo.byIssue")(function* (issueId: IssueId) {
        const rows = yield* sql`SELECT * FROM changes WHERE issue_id = ${issueId}`.pipe(
          Effect.orDie,
        );
        const row = rows[0];
        if (row === undefined) return yield* new ChangeNotFoundError({ id: issueId });
        return yield* decodeRow(row);
      });

      return { ensureForIssue, byId, byIssue };
    }),
  );
}

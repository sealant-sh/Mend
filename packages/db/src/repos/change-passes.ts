import { PgClient } from "@effect/sql-pg";
import { type ChangeId } from "@mend/domain";
import { ChangePass, type PassKind } from "@mend/domain/workbench";
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

import { notifyEvent } from "../events.ts";

const decodePass = Schema.decodeUnknownEffect(Schema.Struct(ChangePass.fields));

/**
 * Machine-pass outcomes over a change (tour · read · suggest): begin marks a
 * run, complete/fail replace it with what happened. Every write notifies the
 * change's SSE pointer, so the review page re-reads instead of guessing —
 * this table is what lets it say "the pass ran and drafted nothing" rather
 * than showing the same silence as "never ran".
 */
export class ChangePassesRepo extends Context.Service<
  ChangePassesRepo,
  {
    readonly begin: (changeId: ChangeId, kind: PassKind) => Effect.Effect<void>;
    /** Findings: how many the pass drafted; null where the kind has no count (the tour). */
    readonly complete: (
      changeId: ChangeId,
      kind: PassKind,
      findings: number | null,
    ) => Effect.Effect<void>;
    readonly fail: (changeId: ChangeId, kind: PassKind, detail: string) => Effect.Effect<void>;
    readonly listForChange: (changeId: ChangeId) => Effect.Effect<ReadonlyArray<ChangePass>>;
  }
>()("@mend/db/ChangePassesRepo") {}

export const ChangePassesRepoLive: Layer.Layer<ChangePassesRepo, never, PgClient.PgClient> =
  Layer.effect(
    ChangePassesRepo,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;

      const notify = (changeId: ChangeId) =>
        sql`SELECT session_id, project_id FROM session_changes WHERE id = ${changeId}`.pipe(
          Effect.orDie,
          Effect.flatMap((rows) => {
            const row = rows[0] as { sessionId: string; projectId: string } | undefined;
            return row === undefined
              ? Effect.void
              : notifyEvent(sql, {
                  type: "session-change",
                  changeId,
                  sessionId: row.sessionId,
                  projectId: row.projectId,
                });
          }),
        );

      const begin = Effect.fn("ChangePassesRepo.begin")(function* (
        changeId: ChangeId,
        kind: PassKind,
      ) {
        yield* sql`
          INSERT INTO change_passes (change_id, kind, status, detail, findings, started_at, finished_at)
          VALUES (${changeId}, ${kind}, 'running', NULL, NULL, now(), NULL)
          ON CONFLICT (change_id, kind) DO UPDATE SET
            status = 'running', detail = NULL, findings = NULL,
            started_at = now(), finished_at = NULL`.pipe(Effect.orDie);
        yield* notify(changeId);
      });

      const complete = Effect.fn("ChangePassesRepo.complete")(function* (
        changeId: ChangeId,
        kind: PassKind,
        findings: number | null,
      ) {
        yield* sql`
          UPDATE change_passes
          SET status = 'completed', findings = ${findings}, detail = NULL, finished_at = now()
          WHERE change_id = ${changeId} AND kind = ${kind}`.pipe(Effect.orDie);
        yield* notify(changeId);
      });

      const fail = Effect.fn("ChangePassesRepo.fail")(function* (
        changeId: ChangeId,
        kind: PassKind,
        detail: string,
      ) {
        yield* sql`
          UPDATE change_passes
          SET status = 'failed', detail = ${detail.slice(0, 1000)}, finished_at = now()
          WHERE change_id = ${changeId} AND kind = ${kind}`.pipe(Effect.orDie);
        yield* notify(changeId);
      });

      const listForChange = Effect.fn("ChangePassesRepo.listForChange")(function* (
        changeId: ChangeId,
      ) {
        const rows = yield* sql`
          SELECT * FROM change_passes WHERE change_id = ${changeId} ORDER BY kind ASC`.pipe(
          Effect.orDie,
        );
        return yield* Effect.forEach(rows, (row) =>
          decodePass(row).pipe(
            Effect.map((decoded) => new ChangePass(decoded)),
            Effect.orDie,
          ),
        );
      });

      return { begin, complete, fail, listForChange };
    }),
  );

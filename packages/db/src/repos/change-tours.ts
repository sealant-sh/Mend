import { PgClient } from "@effect/sql-pg";
import type { ChangeId, SessionId } from "@mend/domain";
import { ChangeTour, TourStop } from "@mend/domain/workbench";
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

import { notifyEvent } from "../events.ts";

const decodeTour = Schema.decodeUnknownEffect(Schema.Struct(ChangeTour.fields));
const encodeStops = Schema.encodeEffect(Schema.Array(TourStop));
const decodeStops = Schema.decodeUnknownEffect(Schema.Array(TourStop));

export interface NewChangeTour {
  readonly changeId: ChangeId;
  readonly sessionId: SessionId;
  readonly summary: string;
  readonly approach: string | null;
  readonly stops: ReadonlyArray<TourStop>;
  readonly diffDigest: string;
}

/** The composed review tour — one per change, replaced whole on recompose. */
export class ChangeToursRepo extends Context.Service<
  ChangeToursRepo,
  {
    readonly upsert: (tour: NewChangeTour) => Effect.Effect<ChangeTour>;
    readonly byChange: (changeId: ChangeId) => Effect.Effect<ChangeTour | null>;
  }
>()("@mend/db/ChangeToursRepo") {
  static readonly layer = Layer.effect(
    ChangeToursRepo,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;

      // stops arrive from jsonb; decode them through the codec so sequences
      // come back as bigints exactly like every other wire.
      const decodeRow = (row: unknown) =>
        Effect.gen(function* () {
          const raw = row as { readonly stops?: unknown };
          const decoded = yield* decodeTour({
            ...(row as Record<string, unknown>),
            stops: [],
          }).pipe(Effect.orDie);
          const stops = yield* decodeStops(raw.stops ?? []).pipe(Effect.orDie);
          return new ChangeTour({ ...decoded, stops });
        });

      const notify = (changeId: ChangeId, sessionId: SessionId) =>
        sql`SELECT project_id FROM session_changes WHERE id = ${changeId}`.pipe(
          Effect.orDie,
          Effect.flatMap((rows) => {
            const row = rows[0] as { projectId: string } | undefined;
            return notifyEvent(sql, {
              type: "session-change",
              changeId,
              sessionId,
              projectId: row?.projectId ?? "",
            });
          }),
        );

      const upsert = Effect.fn("ChangeToursRepo.upsert")(function* (tour: NewChangeTour) {
        const id = crypto.randomUUID();
        const stops = yield* encodeStops(tour.stops).pipe(Effect.orDie);
        const rows = yield* sql`
          INSERT INTO change_tours (id, change_id, session_id, summary, approach, stops, diff_digest)
          VALUES (${id}, ${tour.changeId}, ${tour.sessionId}, ${tour.summary}, ${tour.approach},
                  ${JSON.stringify(stops)}::jsonb, ${tour.diffDigest})
          ON CONFLICT (change_id) DO UPDATE SET
            summary = EXCLUDED.summary,
            approach = EXCLUDED.approach,
            stops = EXCLUDED.stops,
            diff_digest = EXCLUDED.diff_digest,
            created_at = now()
          RETURNING *`.pipe(Effect.orDie);
        const created = yield* decodeRow(rows[0]);
        yield* notify(tour.changeId, tour.sessionId);
        return created;
      });

      const byChange = Effect.fn("ChangeToursRepo.byChange")(function* (changeId: ChangeId) {
        const rows = yield* sql`
          SELECT * FROM change_tours WHERE change_id = ${changeId}`.pipe(Effect.orDie);
        const row = rows[0];
        return row === undefined ? null : yield* decodeRow(row);
      });

      return { upsert, byChange };
    }),
  );
}

import { PgClient } from "@effect/sql-pg";
import { FollowUpId, type ChangeId, type SessionId } from "@mend/domain";
import { FollowUp } from "@mend/domain/workbench";
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

export class FollowUpNotFoundError extends Schema.TaggedErrorClass<FollowUpNotFoundError>()(
  "FollowUpNotFoundError",
  {
    sessionId: Schema.String,
  },
) {}

const decodeFollowUp = Schema.decodeUnknownEffect(Schema.Struct(FollowUp.fields));

/**
 * Assembled review bundles (plan §7.3). One pending follow-up per session at
 * a time — creating a new one supersedes the previous pending row, so the
 * session always picks up exactly what the user last approved.
 */
export class FollowUpsRepo extends Context.Service<
  FollowUpsRepo,
  {
    readonly create: (
      sessionId: SessionId,
      changeId: ChangeId,
      instruction: string,
    ) => Effect.Effect<FollowUp>;
    readonly pendingForSession: (sessionId: SessionId) => Effect.Effect<FollowUp | null>;
    readonly markDelivered: (id: FollowUpId) => Effect.Effect<void>;
  }
>()("@mend/db/FollowUpsRepo") {
  static readonly layer = Layer.effect(
    FollowUpsRepo,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;

      const decodeRow = (row: unknown) =>
        decodeFollowUp(row).pipe(
          Effect.map((decoded) => new FollowUp(decoded)),
          Effect.orDie,
        );

      const create = Effect.fn("FollowUpsRepo.create")(function* (
        sessionId: SessionId,
        changeId: ChangeId,
        instruction: string,
      ) {
        yield* sql`
          UPDATE follow_ups SET status = 'superseded'
          WHERE session_id = ${sessionId} AND status = 'pending'`.pipe(Effect.orDie);
        const id = crypto.randomUUID();
        const rows = yield* sql`
          INSERT INTO follow_ups (id, session_id, change_id, instruction)
          VALUES (${id}, ${sessionId}, ${changeId}, ${instruction})
          RETURNING *`.pipe(Effect.orDie);
        return yield* decodeRow(rows[0]);
      });

      const pendingForSession = Effect.fn("FollowUpsRepo.pendingForSession")(function* (
        sessionId: SessionId,
      ) {
        const rows = yield* sql`
          SELECT * FROM follow_ups
          WHERE session_id = ${sessionId} AND status = 'pending'
          ORDER BY created_at DESC LIMIT 1`.pipe(Effect.orDie);
        const row = rows[0];
        return row === undefined ? null : yield* decodeRow(row);
      });

      const markDelivered = Effect.fn("FollowUpsRepo.markDelivered")(function* (id: FollowUpId) {
        yield* sql`
          UPDATE follow_ups SET status = 'delivered', delivered_at = now()
          WHERE id = ${id}`.pipe(Effect.orDie);
      });

      return { create, pendingForSession, markDelivered };
    }),
  );
}

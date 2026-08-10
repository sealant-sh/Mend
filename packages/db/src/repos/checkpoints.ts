import { PgClient } from "@effect/sql-pg";
import { type SealantRunId, type SessionId, type Sha } from "@mend/domain";
import { Checkpoint, type CheckpointTrigger } from "@mend/domain/workbench";
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

// pg returns bigint columns as strings; decode through the wire shape.
const CheckpointRow = Schema.Struct({
  ...Checkpoint.fields,
  seq: Schema.BigIntFromString,
});
const decodeCheckpoint = Schema.decodeUnknownEffect(CheckpointRow);

export interface NewCheckpoint {
  readonly sessionId: SessionId;
  readonly ref: string;
  readonly sha: Sha;
  readonly sealantRunId: SealantRunId | null;
  readonly seq: bigint;
  readonly trigger: CheckpointTrigger;
}

/**
 * The checkpoint index (plan §5.6): hidden git ref plus exact record pointer.
 * The refs themselves live in the store's bare repo; this table is how the
 * review picks two of them without touching git.
 */
export class CheckpointsRepo extends Context.Service<
  CheckpointsRepo,
  {
    readonly create: (checkpoint: NewCheckpoint) => Effect.Effect<Checkpoint>;
    readonly listForSession: (sessionId: SessionId) => Effect.Effect<ReadonlyArray<Checkpoint>>;
    readonly latestForSession: (sessionId: SessionId) => Effect.Effect<Checkpoint | null>;
    /** Next checkpoint index = count; the engine serializes per-session snapshots. */
    readonly countForSession: (sessionId: SessionId) => Effect.Effect<number>;
  }
>()("@mend/db/CheckpointsRepo") {
  static readonly layer = Layer.effect(
    CheckpointsRepo,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;

      const decodeRow = (row: unknown) =>
        decodeCheckpoint(row).pipe(
          Effect.map((decoded) => new Checkpoint(decoded)),
          Effect.orDie,
        );

      const create = Effect.fn("CheckpointsRepo.create")(function* (checkpoint: NewCheckpoint) {
        const id = crypto.randomUUID();
        const rows = yield* sql`
          INSERT INTO checkpoints (id, session_id, ref, sha, sealant_run_id, seq, trigger)
          VALUES (${id}, ${checkpoint.sessionId}, ${checkpoint.ref}, ${checkpoint.sha},
                  ${checkpoint.sealantRunId}, ${String(checkpoint.seq)}, ${checkpoint.trigger})
          RETURNING *`.pipe(Effect.orDie);
        return yield* decodeRow(rows[0]);
      });

      const listForSession = Effect.fn("CheckpointsRepo.listForSession")(function* (
        sessionId: SessionId,
      ) {
        const rows = yield* sql`
          SELECT * FROM checkpoints WHERE session_id = ${sessionId}
          ORDER BY created_at ASC, id ASC`.pipe(Effect.orDie);
        return yield* Effect.forEach(rows, decodeRow);
      });

      const latestForSession = Effect.fn("CheckpointsRepo.latestForSession")(function* (
        sessionId: SessionId,
      ) {
        const rows = yield* sql`
          SELECT * FROM checkpoints WHERE session_id = ${sessionId}
          ORDER BY created_at DESC, id DESC LIMIT 1`.pipe(Effect.orDie);
        const row = rows[0];
        return row === undefined ? null : yield* decodeRow(row);
      });

      const countForSession = Effect.fn("CheckpointsRepo.countForSession")(function* (
        sessionId: SessionId,
      ) {
        const rows = yield* sql`
          SELECT count(*)::int AS n FROM checkpoints WHERE session_id = ${sessionId}`.pipe(
          Effect.orDie,
        );
        const row = rows[0] as { n: number } | undefined;
        return row?.n ?? 0;
      });

      return { create, listForSession, latestForSession, countForSession };
    }),
  );
}

import { PgClient } from "@effect/sql-pg";
import { type SealantRunId, type SealantWorkspaceId, type SessionId } from "@mend/domain";
import { SessionRun } from "@mend/domain/workbench";
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

const SessionRunRow = Schema.Struct({
  ...SessionRun.fields,
  lastSeenSequence: Schema.BigIntFromString,
});
const decodeSessionRun = Schema.decodeUnknownEffect(SessionRunRow);

export interface NewSessionRun {
  readonly sessionId: SessionId;
  readonly harness: string;
  readonly sealantRunId: SealantRunId;
  readonly sealantWorkspaceId: SealantWorkspaceId;
  readonly sealantSessionId: string | null;
}

export type SessionRunOutcome = "completed" | "failed" | "stopped";

/**
 * Mend's durable membership index over Sealant records. Raw events remain in Sealant; this service
 * owns only which records belong to a logical session and each record's supervision cursor.
 */
export class SessionRunsRepo extends Context.Service<
  SessionRunsRepo,
  {
    readonly create: (input: NewSessionRun) => Effect.Effect<SessionRun>;
    readonly bySealantRunId: (id: SealantRunId) => Effect.Effect<SessionRun | null>;
    readonly listForSession: (sessionId: SessionId) => Effect.Effect<ReadonlyArray<SessionRun>>;
    readonly latestForSession: (sessionId: SessionId) => Effect.Effect<SessionRun | null>;
    readonly activeForSession: (sessionId: SessionId) => Effect.Effect<SessionRun | null>;
    readonly listActive: () => Effect.Effect<ReadonlyArray<SessionRun>>;
    readonly saveLastSeenSequence: (id: SealantRunId, sequence: bigint) => Effect.Effect<void>;
    readonly settle: (
      id: SealantRunId,
      outcome: SessionRunOutcome,
      summary: string | null,
    ) => Effect.Effect<void>;
  }
>()("@mend/db/SessionRunsRepo") {}

export const SessionRunsRepoLive: Layer.Layer<SessionRunsRepo, never, PgClient.PgClient> =
  Layer.effect(
    SessionRunsRepo,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;

      const decodeRow = (row: unknown) =>
        decodeSessionRun(row).pipe(
          Effect.map((decoded) => new SessionRun(decoded)),
          Effect.orDie,
        );

      const create = Effect.fn("SessionRunsRepo.create")(function* (input: NewSessionRun) {
        const rows = yield* sql`
          INSERT INTO session_runs
            (sealant_run_id, session_id, ordinal, harness, sealant_workspace_id,
             sealant_session_id, status)
          VALUES (
            ${input.sealantRunId}, ${input.sessionId},
            (SELECT COALESCE(MAX(ordinal) + 1, 0) FROM session_runs
             WHERE session_id = ${input.sessionId}),
            ${input.harness}, ${input.sealantWorkspaceId}, ${input.sealantSessionId}, 'running'
          )
          RETURNING *`.pipe(Effect.orDie);
        return yield* decodeRow(rows[0]);
      });

      const bySealantRunId = Effect.fn("SessionRunsRepo.bySealantRunId")(function* (
        id: SealantRunId,
      ) {
        const rows = yield* sql`
          SELECT * FROM session_runs WHERE sealant_run_id = ${id}`.pipe(Effect.orDie);
        const row = rows[0];
        return row === undefined ? null : yield* decodeRow(row);
      });

      const listForSession = Effect.fn("SessionRunsRepo.listForSession")(function* (
        sessionId: SessionId,
      ) {
        const rows = yield* sql`
          SELECT * FROM session_runs WHERE session_id = ${sessionId}
          ORDER BY ordinal ASC`.pipe(Effect.orDie);
        return yield* Effect.forEach(rows, decodeRow);
      });

      const latestForSession = Effect.fn("SessionRunsRepo.latestForSession")(function* (
        sessionId: SessionId,
      ) {
        const rows = yield* sql`
          SELECT * FROM session_runs WHERE session_id = ${sessionId}
          ORDER BY ordinal DESC LIMIT 1`.pipe(Effect.orDie);
        const row = rows[0];
        return row === undefined ? null : yield* decodeRow(row);
      });

      const activeForSession = Effect.fn("SessionRunsRepo.activeForSession")(function* (
        sessionId: SessionId,
      ) {
        const rows = yield* sql`
          SELECT * FROM session_runs
          WHERE session_id = ${sessionId} AND settled_at IS NULL
          ORDER BY ordinal DESC LIMIT 1`.pipe(Effect.orDie);
        const row = rows[0];
        return row === undefined ? null : yield* decodeRow(row);
      });

      const listActive = Effect.fn("SessionRunsRepo.listActive")(function* () {
        const rows = yield* sql`
          SELECT * FROM session_runs WHERE settled_at IS NULL
          ORDER BY created_at ASC`.pipe(Effect.orDie);
        return yield* Effect.forEach(rows, decodeRow);
      });

      const saveLastSeenSequence = Effect.fn("SessionRunsRepo.saveLastSeenSequence")(function* (
        id: SealantRunId,
        sequence: bigint,
      ) {
        yield* sql`
          UPDATE session_runs
          SET last_seen_sequence = ${String(sequence)}, updated_at = now()
          WHERE sealant_run_id = ${id}
            AND last_seen_sequence < ${String(sequence)}`.pipe(Effect.orDie);
      });

      const settle = Effect.fn("SessionRunsRepo.settle")(function* (
        id: SealantRunId,
        outcome: SessionRunOutcome,
        summary: string | null,
      ) {
        yield* sql`
          UPDATE session_runs
          SET status = ${outcome}, summary = ${summary}, settled_at = now(), updated_at = now()
          WHERE sealant_run_id = ${id} AND settled_at IS NULL`.pipe(Effect.orDie);
      });

      return {
        create,
        bySealantRunId,
        listForSession,
        latestForSession,
        activeForSession,
        listActive,
        saveLastSeenSequence,
        settle,
      };
    }),
  );

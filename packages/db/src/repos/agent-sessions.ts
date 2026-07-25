import { PgClient } from "@effect/sql-pg";
import {
  type ContextSnapshotId,
  type ProjectId,
  type SealantRunId,
  type SealantWorkspaceId,
  SessionId,
  type Sha,
} from "@mend/domain";
import { Session, type SessionStatus } from "@mend/domain/workbench";
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

import { notifyEvent } from "../events.ts";

export class SessionNotFoundError extends Schema.TaggedErrorClass<SessionNotFoundError>()(
  "SessionNotFoundError",
  {
    sessionId: Schema.String,
  },
) {}

// pg returns bigint columns as strings; decode through the wire shape.
const SessionRow = Schema.Struct({
  ...Session.fields,
  lastSeenSequence: Schema.BigIntFromString,
});
const decodeSession = Schema.decodeUnknownEffect(SessionRow);

export interface NewSession {
  /** Caller-supplied: the engine names the worktree after the id before the row exists. */
  readonly id: SessionId;
  readonly projectId: ProjectId;
  readonly harness: string;
  readonly label: string | null;
  readonly worktree: string;
  readonly branch: string;
  readonly baseSha: Sha;
  readonly contextSnapshotId: ContextSnapshotId | null;
}

/** Terminal session states; `stopped` is the user's stop, not a failure. */
export type SessionOutcome = "completed" | "failed" | "stopped";

/**
 * The index of supervised agent sessions (plan §5.5) — table `agent_sessions`
 * (better-auth owns `"session"`). The recording stays in Sealant, addressed
 * by `(sealantRunId, sequence)`; `lastSeenSequence` is the crash-resume mark.
 */
export class SessionsRepo extends Context.Service<
  SessionsRepo,
  {
    readonly create: (session: NewSession) => Effect.Effect<Session>;
    readonly byId: (id: SessionId) => Effect.Effect<Session, SessionNotFoundError>;
    readonly listForProject: (projectId: ProjectId) => Effect.Effect<ReadonlyArray<Session>>;
    /** Sessions in a live state, across projects — the Now inbox reads this. */
    readonly listActive: () => Effect.Effect<ReadonlyArray<Session>>;
    /** Sessions to re-attach to after a crash/restart. */
    readonly listUnsettled: () => Effect.Effect<ReadonlyArray<Session>>;
    readonly setSealantIds: (
      id: SessionId,
      sealantRunId: SealantRunId,
      workspaceId: SealantWorkspaceId,
    ) => Effect.Effect<void>;
    readonly setProviderSessionId: (id: SessionId, providerId: string) => Effect.Effect<void>;
    readonly setStatus: (id: SessionId, status: SessionStatus) => Effect.Effect<void>;
    readonly saveLastSeenSequence: (id: SessionId, sequence: bigint) => Effect.Effect<void>;
    /** Live progress pointer for the Now feed and session page (plan §9.4). */
    readonly notifyProgress: (id: SessionId, sequence: bigint, line: string) => Effect.Effect<void>;
    readonly settle: (
      id: SessionId,
      outcome: SessionOutcome,
      summary: string | null,
    ) => Effect.Effect<void>;
    /** A delivered follow-up resumes the settled session — same row, same worktree, same change. */
    readonly reopen: (id: SessionId) => Effect.Effect<void>;
  }
>()("@mend/db/SessionsRepo") {
  static readonly layer = Layer.effect(
    SessionsRepo,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;

      const decodeRow = (row: unknown) =>
        decodeSession(row).pipe(
          Effect.map((decoded) => new Session(decoded)),
          Effect.orDie,
        );

      const projectIdOf = (id: SessionId) =>
        sql`SELECT project_id FROM agent_sessions WHERE id = ${id}`.pipe(
          Effect.orDie,
          Effect.map((rows) => {
            const row = rows[0] as { projectId: string } | undefined;
            return row?.projectId ?? "";
          }),
        );

      const notify = (id: SessionId) =>
        Effect.gen(function* () {
          const projectId = yield* projectIdOf(id);
          yield* notifyEvent(sql, { type: "session", sessionId: id, projectId });
        });

      const create = Effect.fn("SessionsRepo.create")(function* (session: NewSession) {
        const rows = yield* sql`
          INSERT INTO agent_sessions
            (id, project_id, harness, label, worktree, branch, base_sha, context_snapshot_id)
          VALUES (${session.id}, ${session.projectId}, ${session.harness}, ${session.label},
                  ${session.worktree}, ${session.branch}, ${session.baseSha},
                  ${session.contextSnapshotId})
          RETURNING *`.pipe(Effect.orDie);
        const created = yield* decodeRow(rows[0]);
        yield* notifyEvent(sql, {
          type: "session",
          sessionId: created.id,
          projectId: session.projectId,
        });
        return created;
      });

      const byId = Effect.fn("SessionsRepo.byId")(function* (id: SessionId) {
        const rows = yield* sql`SELECT * FROM agent_sessions WHERE id = ${id}`.pipe(Effect.orDie);
        const row = rows[0];
        if (row === undefined) return yield* new SessionNotFoundError({ sessionId: id });
        return yield* decodeRow(row);
      });

      const listForProject = Effect.fn("SessionsRepo.listForProject")(function* (
        projectId: ProjectId,
      ) {
        const rows = yield* sql`
          SELECT * FROM agent_sessions WHERE project_id = ${projectId}
          ORDER BY created_at DESC`.pipe(Effect.orDie);
        return yield* Effect.forEach(rows, decodeRow);
      });

      const listActive = Effect.fn("SessionsRepo.listActive")(function* () {
        const rows = yield* sql`
          SELECT * FROM agent_sessions
          WHERE status IN ('starting', 'running', 'waiting', 'idle')
          ORDER BY created_at DESC`.pipe(Effect.orDie);
        return yield* Effect.forEach(rows, decodeRow);
      });

      const listUnsettled = Effect.fn("SessionsRepo.listUnsettled")(function* () {
        const rows = yield* sql`
          SELECT * FROM agent_sessions
          WHERE settled_at IS NULL AND status <> 'starting'
          ORDER BY created_at ASC`.pipe(Effect.orDie);
        return yield* Effect.forEach(rows, decodeRow);
      });

      const setSealantIds = Effect.fn("SessionsRepo.setSealantIds")(function* (
        id: SessionId,
        sealantRunId: SealantRunId,
        workspaceId: SealantWorkspaceId,
      ) {
        yield* sql`
          UPDATE agent_sessions
          SET sealant_run_id = ${sealantRunId}, sealant_workspace_id = ${workspaceId},
              updated_at = now()
          WHERE id = ${id}`.pipe(Effect.orDie);
      });

      const setProviderSessionId = Effect.fn("SessionsRepo.setProviderSessionId")(function* (
        id: SessionId,
        providerId: string,
      ) {
        yield* sql`
          UPDATE agent_sessions SET provider_session_id = ${providerId}, updated_at = now()
          WHERE id = ${id}`.pipe(Effect.orDie);
      });

      const setStatus = Effect.fn("SessionsRepo.setStatus")(function* (
        id: SessionId,
        status: SessionStatus,
      ) {
        yield* sql`
          UPDATE agent_sessions
          SET status = ${status},
              started_at = CASE WHEN ${status} = 'running' THEN COALESCE(started_at, now())
                           ELSE started_at END,
              updated_at = now()
          WHERE id = ${id}`.pipe(Effect.orDie);
        yield* notify(id);
      });

      const saveLastSeenSequence = Effect.fn("SessionsRepo.saveLastSeenSequence")(function* (
        id: SessionId,
        sequence: bigint,
      ) {
        yield* sql`
          UPDATE agent_sessions SET last_seen_sequence = ${String(sequence)}, updated_at = now()
          WHERE id = ${id} AND last_seen_sequence < ${String(sequence)}`.pipe(Effect.orDie);
      });

      const notifyProgress = Effect.fn("SessionsRepo.notifyProgress")(function* (
        id: SessionId,
        sequence: bigint,
        line: string,
      ) {
        const projectId = yield* projectIdOf(id);
        yield* notifyEvent(sql, {
          type: "session-progress",
          sessionId: id,
          projectId,
          sequence: String(sequence),
          line,
        });
      });

      const settle = Effect.fn("SessionsRepo.settle")(function* (
        id: SessionId,
        outcome: SessionOutcome,
        summary: string | null,
      ) {
        yield* sql`
          UPDATE agent_sessions
          SET status = ${outcome}, summary = ${summary}, settled_at = now(), updated_at = now()
          WHERE id = ${id}`.pipe(Effect.orDie);
        yield* notify(id);
      });

      const reopen = Effect.fn("SessionsRepo.reopen")(function* (id: SessionId) {
        yield* sql`
          UPDATE agent_sessions
          SET status = 'running', settled_at = NULL, updated_at = now()
          WHERE id = ${id}`.pipe(Effect.orDie);
        yield* notify(id);
      });

      return {
        create,
        byId,
        listForProject,
        listActive,
        listUnsettled,
        setSealantIds,
        setProviderSessionId,
        setStatus,
        saveLastSeenSequence,
        notifyProgress,
        settle,
        reopen,
      };
    }),
  );
}

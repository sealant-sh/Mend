import { PgClient } from "@effect/sql-pg";
import { ChangeId, type ProjectId, type SessionId, type Sha } from "@mend/domain";
import { Change } from "@mend/domain/workbench";
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

import { notifyEvent } from "../events.ts";

export class SessionChangeNotFoundError extends Schema.TaggedErrorClass<SessionChangeNotFoundError>()(
  "SessionChangeNotFoundError",
  {
    id: Schema.String,
  },
) {}

const decodeChange = Schema.decodeUnknownEffect(Schema.Struct(Change.fields));

/**
 * The reviewable object's identity row (plan §5.6) — one per session, table
 * `session_changes`. Git owns the diff; `head_sha` is an opportunistic cache
 * for display, refreshed by whoever looked last.
 */
export class SessionChangesRepo extends Context.Service<
  SessionChangesRepo,
  {
    /** Idempotent: the session's change row, created on first ask. */
    readonly ensureForSession: (
      projectId: ProjectId,
      sessionId: SessionId,
      branch: string,
      baseSha: Sha,
    ) => Effect.Effect<Change>;
    readonly byId: (id: ChangeId) => Effect.Effect<Change, SessionChangeNotFoundError>;
    readonly bySession: (sessionId: SessionId) => Effect.Effect<Change | null>;
    readonly refreshHead: (id: ChangeId, headSha: Sha) => Effect.Effect<void>;
  }
>()("@mend/db/SessionChangesRepo") {
  static readonly layer = Layer.effect(
    SessionChangesRepo,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;

      const decodeRow = (row: unknown) =>
        decodeChange(row).pipe(
          Effect.map((decoded) => new Change(decoded)),
          Effect.orDie,
        );

      const ensureForSession = Effect.fn("SessionChangesRepo.ensureForSession")(function* (
        projectId: ProjectId,
        sessionId: SessionId,
        branch: string,
        baseSha: Sha,
      ) {
        const id = crypto.randomUUID();
        const rows = yield* sql`
          INSERT INTO session_changes (id, project_id, session_id, branch, base_sha)
          VALUES (${id}, ${projectId}, ${sessionId}, ${branch}, ${baseSha})
          ON CONFLICT (session_id) DO UPDATE SET updated_at = now()
          RETURNING *`.pipe(Effect.orDie);
        return yield* decodeRow(rows[0]);
      });

      const byId = Effect.fn("SessionChangesRepo.byId")(function* (id: ChangeId) {
        const rows = yield* sql`SELECT * FROM session_changes WHERE id = ${id}`.pipe(Effect.orDie);
        const row = rows[0];
        if (row === undefined) return yield* new SessionChangeNotFoundError({ id });
        return yield* decodeRow(row);
      });

      const bySession = Effect.fn("SessionChangesRepo.bySession")(function* (sessionId: SessionId) {
        const rows = yield* sql`
          SELECT * FROM session_changes WHERE session_id = ${sessionId}`.pipe(Effect.orDie);
        const row = rows[0];
        return row === undefined ? null : yield* decodeRow(row);
      });

      const refreshHead = Effect.fn("SessionChangesRepo.refreshHead")(function* (
        id: ChangeId,
        headSha: Sha,
      ) {
        const rows = yield* sql`
          UPDATE session_changes SET head_sha = ${headSha}, updated_at = now()
          WHERE id = ${id} AND head_sha IS DISTINCT FROM ${headSha}
          RETURNING session_id, project_id`.pipe(Effect.orDie);
        const row = rows[0] as { sessionId: string; projectId: string } | undefined;
        if (row !== undefined) {
          yield* notifyEvent(sql, {
            type: "session-change",
            changeId: id,
            sessionId: row.sessionId,
            projectId: row.projectId,
          });
        }
      });

      return { ensureForSession, byId, bySession, refreshHead };
    }),
  );
}

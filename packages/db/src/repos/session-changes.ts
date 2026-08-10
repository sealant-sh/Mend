import { PgClient } from "@effect/sql-pg";
import { ChangeId, type ProjectId, type SessionId, type Sha } from "@mend/domain";
import { Change } from "@mend/domain/workbench";
import { and, count, eq, isNull, ne, or } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

import { MendDB } from "../client.ts";
import { notifyEvent } from "../events.ts";
import { agentSessions, followUps, reviewComments, sessionChanges } from "../schema/workbench.ts";

export class SessionChangeNotFoundError extends Schema.TaggedErrorClass<SessionChangeNotFoundError>()(
  "SessionChangeNotFoundError",
  {
    id: Schema.String,
  },
) {}

/**
 * The DB-cheap facts a session list can carry without touching git: whether
 * a change row exists, how the review stands, whether a follow-up waits.
 */
export interface SessionAnnotationRow {
  readonly sessionId: string;
  readonly changeId: ChangeId | null;
  readonly openComments: number;
  readonly totalComments: number;
  readonly pendingFollowUp: boolean;
}

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
    /** One row per session of the project — list decoration, no git involved. */
    readonly annotationsForProject: (
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<SessionAnnotationRow>>;
  }
>()("@mend/db/SessionChangesRepo") {}

const toChange = (row: typeof sessionChanges.$inferSelect): Change => new Change(row);

export const SessionChangesRepoLive: Layer.Layer<
  SessionChangesRepo,
  never,
  MendDB | PgClient.PgClient
> = Layer.effect(
  SessionChangesRepo,
  Effect.gen(function* () {
    const db = yield* MendDB;
    const sql = yield* PgClient.PgClient;

    const ensureForSession = Effect.fn("SessionChangesRepo.ensureForSession")(function* (
      projectId: ProjectId,
      sessionId: SessionId,
      branch: string,
      baseSha: Sha,
    ) {
      const [row] = yield* db
        .insert(sessionChanges)
        .values({
          id: ChangeId.make(crypto.randomUUID()),
          projectId,
          sessionId,
          branch,
          baseSha,
        })
        .onConflictDoUpdate({
          target: sessionChanges.sessionId,
          set: { updatedAt: new Date() },
        })
        .returning()
        .pipe(Effect.orDie);
      if (row === undefined) return yield* Effect.die("session change upsert returned no row");
      return toChange(row);
    });

    const byId = Effect.fn("SessionChangesRepo.byId")(function* (id: ChangeId) {
      const [row] = yield* db
        .select()
        .from(sessionChanges)
        .where(eq(sessionChanges.id, id))
        .limit(1)
        .pipe(Effect.orDie);
      if (row === undefined) return yield* new SessionChangeNotFoundError({ id });
      return toChange(row);
    });

    const bySession = Effect.fn("SessionChangesRepo.bySession")(function* (sessionId: SessionId) {
      const [row] = yield* db
        .select()
        .from(sessionChanges)
        .where(eq(sessionChanges.sessionId, sessionId))
        .limit(1)
        .pipe(Effect.orDie);
      return row === undefined ? null : toChange(row);
    });

    const refreshHead = Effect.fn("SessionChangesRepo.refreshHead")(function* (
      id: ChangeId,
      headSha: Sha,
    ) {
      const [row] = yield* db
        .update(sessionChanges)
        .set({ headSha, updatedAt: new Date() })
        .where(
          and(
            eq(sessionChanges.id, id),
            or(isNull(sessionChanges.headSha), ne(sessionChanges.headSha, headSha)),
          ),
        )
        .returning({ sessionId: sessionChanges.sessionId, projectId: sessionChanges.projectId })
        .pipe(Effect.orDie);
      if (row !== undefined) {
        yield* notifyEvent(sql, {
          type: "session-change",
          changeId: id,
          sessionId: row.sessionId,
          projectId: row.projectId,
        });
      }
    });

    const annotationsForProject = Effect.fn("SessionChangesRepo.annotationsForProject")(function* (
      projectId: ProjectId,
    ) {
      const openCommentCounts = db
        .select({
          changeId: reviewComments.changeId,
          value: count().as("open_comments"),
        })
        .from(reviewComments)
        .where(eq(reviewComments.state, "open"))
        .groupBy(reviewComments.changeId)
        .as("open_comment_counts");
      const totalCommentCounts = db
        .select({
          changeId: reviewComments.changeId,
          value: count().as("total_comments"),
        })
        .from(reviewComments)
        .groupBy(reviewComments.changeId)
        .as("total_comment_counts");
      const sessionsWithPendingFollowUps = db
        .select({ sessionId: followUps.sessionId })
        .from(followUps)
        .where(eq(followUps.status, "pending"))
        .groupBy(followUps.sessionId)
        .as("sessions_with_pending_follow_ups");

      const rows = yield* db
        .select({
          sessionId: agentSessions.id,
          changeId: sessionChanges.id,
          openComments: openCommentCounts.value,
          totalComments: totalCommentCounts.value,
          pendingSessionId: sessionsWithPendingFollowUps.sessionId,
        })
        .from(agentSessions)
        .leftJoin(sessionChanges, eq(sessionChanges.sessionId, agentSessions.id))
        .leftJoin(openCommentCounts, eq(openCommentCounts.changeId, sessionChanges.id))
        .leftJoin(totalCommentCounts, eq(totalCommentCounts.changeId, sessionChanges.id))
        .leftJoin(
          sessionsWithPendingFollowUps,
          eq(sessionsWithPendingFollowUps.sessionId, agentSessions.id),
        )
        .where(eq(agentSessions.projectId, projectId))
        .pipe(Effect.orDie);

      return rows.map(
        (row): SessionAnnotationRow => ({
          sessionId: row.sessionId,
          changeId: row.changeId,
          openComments: row.openComments ?? 0,
          totalComments: row.totalComments ?? 0,
          pendingFollowUp: row.pendingSessionId !== null,
        }),
      );
    });

    return { ensureForSession, byId, bySession, refreshHead, annotationsForProject };
  }),
);

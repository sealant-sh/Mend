import { SessionProcessId, type SealantWorkspaceId, type SessionId } from "@mend/domain";
import { SessionProcess, type SessionProcessKind } from "@mend/domain/workbench";
import { and, asc, eq, isNull } from "drizzle-orm";
import { Effect, Layer } from "effect";
import * as Context from "effect/Context";

import { MendDB } from "../client.ts";
import { sessionProcesses } from "../schema/workbench.ts";

export interface NewSessionProcess {
  readonly sessionId: SessionId;
  readonly sealantWorkspaceId: SealantWorkspaceId;
  readonly sealantSessionId: string;
  readonly kind: SessionProcessKind;
  readonly label: string | null;
  readonly argv: ReadonlyArray<string>;
}

/**
 * The plural process index over a session's workspace (docs/SESSION-SERVICES.md): the agent,
 * shells, and Services are each one row, independently attachable and independently settled. Live
 * rows (`exitedAt IS NULL`) are the workspace's leases — the engine reclaims the container only
 * when the last one ends.
 */
export class SessionProcessesRepo extends Context.Service<
  SessionProcessesRepo,
  {
    readonly create: (input: NewSessionProcess) => Effect.Effect<SessionProcess>;
    readonly byId: (id: SessionProcessId) => Effect.Effect<SessionProcess | null>;
    readonly listForSession: (sessionId: SessionId) => Effect.Effect<ReadonlyArray<SessionProcess>>;
    readonly listLiveForWorkspace: (
      workspaceId: SealantWorkspaceId,
    ) => Effect.Effect<ReadonlyArray<SessionProcess>>;
    readonly markExited: (
      id: SessionProcessId,
      outcome: "exited" | "stopped",
      exitCode: number | null,
    ) => Effect.Effect<void>;
    /** Reconcile: end every live row for a workspace (optionally one kind). Exit codes unknown. */
    readonly reapLiveForWorkspace: (
      workspaceId: SealantWorkspaceId,
      kind?: SessionProcessKind,
    ) => Effect.Effect<void>;
  }
>()("@mend/db/SessionProcessesRepo") {}

const toSessionProcess = (row: typeof sessionProcesses.$inferSelect): SessionProcess =>
  new SessionProcess(row);

export const SessionProcessesRepoLive: Layer.Layer<SessionProcessesRepo, never, MendDB> =
  Layer.effect(
    SessionProcessesRepo,
    Effect.gen(function* () {
      const db = yield* MendDB;

      const create = Effect.fn("SessionProcessesRepo.create")(function* (input: NewSessionProcess) {
        const [created] = yield* db
          .insert(sessionProcesses)
          .values({
            ...input,
            id: SessionProcessId.make(crypto.randomUUID()),
            status: "running",
          })
          .returning()
          .pipe(Effect.orDie);
        if (created === undefined)
          return yield* Effect.die("session process insert returned no row");
        return toSessionProcess(created);
      });

      const byId = Effect.fn("SessionProcessesRepo.byId")(function* (id: SessionProcessId) {
        const [row] = yield* db
          .select()
          .from(sessionProcesses)
          .where(eq(sessionProcesses.id, id))
          .limit(1)
          .pipe(Effect.orDie);
        return row === undefined ? null : toSessionProcess(row);
      });

      const listForSession = Effect.fn("SessionProcessesRepo.listForSession")(function* (
        sessionId: SessionId,
      ) {
        const rows = yield* db
          .select()
          .from(sessionProcesses)
          .where(eq(sessionProcesses.sessionId, sessionId))
          .orderBy(asc(sessionProcesses.createdAt))
          .pipe(Effect.orDie);
        return rows.map(toSessionProcess);
      });

      const listLiveForWorkspace = Effect.fn("SessionProcessesRepo.listLiveForWorkspace")(
        function* (workspaceId: SealantWorkspaceId) {
          const rows = yield* db
            .select()
            .from(sessionProcesses)
            .where(
              and(
                eq(sessionProcesses.sealantWorkspaceId, workspaceId),
                isNull(sessionProcesses.exitedAt),
              ),
            )
            .orderBy(asc(sessionProcesses.createdAt))
            .pipe(Effect.orDie);
          return rows.map(toSessionProcess);
        },
      );

      const markExited = Effect.fn("SessionProcessesRepo.markExited")(function* (
        id: SessionProcessId,
        outcome: "exited" | "stopped",
        exitCode: number | null,
      ) {
        const now = new Date();
        yield* db
          .update(sessionProcesses)
          .set({ status: outcome, exitCode, exitedAt: now, updatedAt: now })
          .where(and(eq(sessionProcesses.id, id), isNull(sessionProcesses.exitedAt)))
          .pipe(Effect.orDie);
      });

      const reapLiveForWorkspace = Effect.fn("SessionProcessesRepo.reapLiveForWorkspace")(
        function* (workspaceId: SealantWorkspaceId, kind?: SessionProcessKind) {
          const now = new Date();
          yield* db
            .update(sessionProcesses)
            .set({ status: "exited", exitedAt: now, updatedAt: now })
            .where(
              and(
                eq(sessionProcesses.sealantWorkspaceId, workspaceId),
                isNull(sessionProcesses.exitedAt),
                ...(kind === undefined ? [] : [eq(sessionProcesses.kind, kind)]),
              ),
            )
            .pipe(Effect.orDie);
        },
      );

      return {
        create,
        byId,
        listForSession,
        listLiveForWorkspace,
        markExited,
        reapLiveForWorkspace,
      };
    }),
  );

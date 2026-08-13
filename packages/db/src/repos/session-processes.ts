import {
  SessionProcessId,
  type SealantRunId,
  type SealantWorkspaceId,
  type SessionId,
} from "@mend/domain";
import {
  SessionProcess,
  type SessionProcessKind,
  type SessionProcessStatus,
} from "@mend/domain/workbench";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { Effect, Layer } from "effect";
import * as Context from "effect/Context";

import { MendDB } from "../client.ts";
import { sessionProcesses } from "../schema/workbench.ts";

export interface NewSessionProcess {
  readonly sessionId: SessionId;
  readonly sealantWorkspaceId: SealantWorkspaceId;
  /** Null for adopted Services — a port Mend forwards without owning a process. */
  readonly sealantSessionId: string | null;
  /** The run recording this process; null for adopted Services. */
  readonly sealantRunId?: SealantRunId | null;
  readonly kind: SessionProcessKind;
  readonly label: string | null;
  readonly argv: ReadonlyArray<string>;
  /** Initial observed state; defaults to "running" (the PTY paths). */
  readonly status?: SessionProcessStatus;
  readonly workspacePort?: number | null;
  readonly hostPort?: number | null;
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
    /** Every live row across all workspaces — boot re-attaches watchers from this. */
    readonly listLive: () => Effect.Effect<ReadonlyArray<SessionProcess>>;
    /** Services newest-first, live AND recently ended — post-mortem logs address the dead. */
    readonly listRecentServices: () => Effect.Effect<ReadonlyArray<SessionProcess>>;
    /** Flip a LIVE row's observed state (reachable ⇄ unreachable, starting → running). */
    readonly setStatus: (id: SessionProcessId, status: SessionProcessStatus) => Effect.Effect<void>;
    /** Record the bound host port once the listener exists (Services only). */
    readonly setHostPort: (id: SessionProcessId, hostPort: number) => Effect.Effect<void>;
    /** Point a LIVE row at a fresh platform PTY + run (Service restart keeps identity + URL). */
    readonly setSealantSessionId: (
      id: SessionProcessId,
      sealantSessionId: string,
      sealantRunId: SealantRunId | null,
    ) => Effect.Effect<void>;
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
            status: input.status ?? "running",
          })
          .returning()
          .pipe(Effect.orDie);
        if (created === undefined)
          return yield* Effect.die("session process insert returned no row");
        return toSessionProcess(created);
      });

      const setStatus = Effect.fn("SessionProcessesRepo.setStatus")(function* (
        id: SessionProcessId,
        status: SessionProcessStatus,
      ) {
        yield* db
          .update(sessionProcesses)
          .set({ status, updatedAt: new Date() })
          .where(and(eq(sessionProcesses.id, id), isNull(sessionProcesses.exitedAt)))
          .pipe(Effect.orDie);
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

      const listRecentServices = Effect.fn("SessionProcessesRepo.listRecentServices")(function* () {
        const rows = yield* db
          .select()
          .from(sessionProcesses)
          .where(eq(sessionProcesses.kind, "service"))
          .orderBy(desc(sessionProcesses.createdAt))
          .limit(100)
          .pipe(Effect.orDie);
        return rows.map(toSessionProcess);
      });

      const listLive = Effect.fn("SessionProcessesRepo.listLive")(function* () {
        const rows = yield* db
          .select()
          .from(sessionProcesses)
          .where(isNull(sessionProcesses.exitedAt))
          .orderBy(asc(sessionProcesses.createdAt))
          .pipe(Effect.orDie);
        return rows.map(toSessionProcess);
      });

      const setHostPort = Effect.fn("SessionProcessesRepo.setHostPort")(function* (
        id: SessionProcessId,
        hostPort: number,
      ) {
        yield* db
          .update(sessionProcesses)
          .set({ hostPort, updatedAt: new Date() })
          .where(and(eq(sessionProcesses.id, id), isNull(sessionProcesses.exitedAt)))
          .pipe(Effect.orDie);
      });

      const setSealantSessionId = Effect.fn("SessionProcessesRepo.setSealantSessionId")(function* (
        id: SessionProcessId,
        sealantSessionId: string,
        sealantRunId: SealantRunId | null,
      ) {
        yield* db
          .update(sessionProcesses)
          .set({ sealantSessionId, sealantRunId, updatedAt: new Date() })
          .where(and(eq(sessionProcesses.id, id), isNull(sessionProcesses.exitedAt)))
          .pipe(Effect.orDie);
      });

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
        listLive,
        listRecentServices,
        setStatus,
        setHostPort,
        setSealantSessionId,
        markExited,
        reapLiveForWorkspace,
      };
    }),
  );

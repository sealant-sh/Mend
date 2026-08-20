import { PgClient } from "@effect/sql-pg";
import {
  SessionProcessId,
  type ServiceId,
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
import { notifyEvent } from "../events.ts";
import { agentSessions, sessionProcesses } from "../schema/workbench.ts";

export interface NewSessionProcess {
  readonly id?: SessionProcessId;
  readonly sessionId: SessionId;
  readonly sealantWorkspaceId: SealantWorkspaceId;
  /** Null for adopted Services — a port Mend forwards without owning a process. */
  readonly sealantSessionId: string | null;
  /** The run recording this process; null for adopted Services. */
  readonly sealantRunId?: SealantRunId | null;
  /** Server-owned launch intent used to reconcile an accepted process after a retry. */
  readonly launchCorrelationId?: string | null;
  /** Stable Service identity when this row is a Service process attempt. */
  readonly serviceId?: ServiceId | null;
  readonly attemptOrdinal?: number | null;
  readonly kind: SessionProcessKind;
  readonly label: string | null;
  readonly argv: ReadonlyArray<string>;
  /** Initial observed state; defaults to "running" (the PTY paths). */
  readonly status?: SessionProcessStatus;
  readonly workspacePort?: number | null;
  readonly hostPort?: number | null;
  /** Declared transport for Services; defaults to tcp. */
  readonly protocol?: "tcp" | "udp";
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
    readonly byLaunchCorrelation: (correlationId: string) => Effect.Effect<SessionProcess | null>;
    readonly listForSession: (sessionId: SessionId) => Effect.Effect<ReadonlyArray<SessionProcess>>;
    readonly listForService: (serviceId: ServiceId) => Effect.Effect<ReadonlyArray<SessionProcess>>;
    readonly listLiveForWorkspace: (
      workspaceId: SealantWorkspaceId,
    ) => Effect.Effect<ReadonlyArray<SessionProcess>>;
    /** Every live row across all workspaces — boot re-attaches watchers from this. */
    readonly listLive: () => Effect.Effect<ReadonlyArray<SessionProcess>>;
    /** Services newest-first, live AND recently ended — post-mortem logs address the dead. */
    readonly listRecentServices: () => Effect.Effect<ReadonlyArray<SessionProcess>>;
    /** Flip a LIVE row's observed state (reachable ⇄ unreachable, starting → running). */
    readonly setStatus: (id: SessionProcessId, status: SessionProcessStatus) => Effect.Effect<void>;
    /** Rename a live supporting process. The engine owns kind and label validation. */
    readonly setLabel: (id: SessionProcessId, label: string) => Effect.Effect<void>;
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

export const SessionProcessesRepoLive: Layer.Layer<
  SessionProcessesRepo,
  never,
  MendDB | PgClient.PgClient
> = Layer.effect(
  SessionProcessesRepo,
  Effect.gen(function* () {
    const db = yield* MendDB;
    const pg = yield* PgClient.PgClient;

    /** Pointer events only — clients re-read through the API. */
    const notify = Effect.fn("SessionProcessesRepo.notify")(function* (sessionId: SessionId) {
      const [row] = yield* db
        .select({ projectId: agentSessions.projectId })
        .from(agentSessions)
        .where(eq(agentSessions.id, sessionId))
        .limit(1)
        .pipe(Effect.orDie);
      yield* notifyEvent(pg, {
        type: "session-process",
        sessionId,
        projectId: row?.projectId ?? "",
      });
    });

    const create = Effect.fn("SessionProcessesRepo.create")(function* (input: NewSessionProcess) {
      const [created] = yield* db
        .insert(sessionProcesses)
        .values({
          ...input,
          id: input.id ?? SessionProcessId.make(crypto.randomUUID()),
          launchCorrelationId: input.launchCorrelationId ?? null,
          serviceId: input.serviceId ?? null,
          attemptOrdinal: input.attemptOrdinal ?? null,
          status: input.status ?? "running",
        })
        .returning()
        .pipe(Effect.orDie);
      if (created === undefined) return yield* Effect.die("session process insert returned no row");
      yield* notify(created.sessionId);
      return toSessionProcess(created);
    });

    const setStatus = Effect.fn("SessionProcessesRepo.setStatus")(function* (
      id: SessionProcessId,
      status: SessionProcessStatus,
    ) {
      const rows = yield* db
        .update(sessionProcesses)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(sessionProcesses.id, id), isNull(sessionProcesses.exitedAt)))
        .returning({ sessionId: sessionProcesses.sessionId })
        .pipe(Effect.orDie);
      const first = rows[0];
      if (first !== undefined) yield* notify(first.sessionId);
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

    const byLaunchCorrelation = Effect.fn("SessionProcessesRepo.byLaunchCorrelation")(function* (
      correlationId: string,
    ) {
      const [row] = yield* db
        .select()
        .from(sessionProcesses)
        .where(eq(sessionProcesses.launchCorrelationId, correlationId))
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

    const listForService = Effect.fn("SessionProcessesRepo.listForService")(function* (
      serviceId: ServiceId,
    ) {
      const rows = yield* db
        .select()
        .from(sessionProcesses)
        .where(eq(sessionProcesses.serviceId, serviceId))
        .orderBy(asc(sessionProcesses.attemptOrdinal))
        .pipe(Effect.orDie);
      return rows.map(toSessionProcess);
    });

    const listLiveForWorkspace = Effect.fn("SessionProcessesRepo.listLiveForWorkspace")(function* (
      workspaceId: SealantWorkspaceId,
    ) {
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
    });

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

    const setLabel = Effect.fn("SessionProcessesRepo.setLabel")(function* (
      id: SessionProcessId,
      label: string,
    ) {
      const rows = yield* db
        .update(sessionProcesses)
        .set({ label, updatedAt: new Date() })
        .where(and(eq(sessionProcesses.id, id), isNull(sessionProcesses.exitedAt)))
        .returning({ sessionId: sessionProcesses.sessionId })
        .pipe(Effect.orDie);
      const first = rows[0];
      if (first !== undefined) yield* notify(first.sessionId);
    });

    const setHostPort = Effect.fn("SessionProcessesRepo.setHostPort")(function* (
      id: SessionProcessId,
      hostPort: number,
    ) {
      const rows = yield* db
        .update(sessionProcesses)
        .set({ hostPort, updatedAt: new Date() })
        .where(and(eq(sessionProcesses.id, id), isNull(sessionProcesses.exitedAt)))
        .returning({ sessionId: sessionProcesses.sessionId })
        .pipe(Effect.orDie);
      const first = rows[0];
      if (first !== undefined) yield* notify(first.sessionId);
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
      const rows = yield* db
        .update(sessionProcesses)
        .set({ status: outcome, exitCode, exitedAt: now, updatedAt: now })
        .where(and(eq(sessionProcesses.id, id), isNull(sessionProcesses.exitedAt)))
        .returning({ sessionId: sessionProcesses.sessionId })
        .pipe(Effect.orDie);
      const first = rows[0];
      if (first !== undefined) yield* notify(first.sessionId);
    });

    const reapLiveForWorkspace = Effect.fn("SessionProcessesRepo.reapLiveForWorkspace")(function* (
      workspaceId: SealantWorkspaceId,
      kind?: SessionProcessKind,
    ) {
      const now = new Date();
      const rows = yield* db
        .update(sessionProcesses)
        .set({ status: "exited", exitedAt: now, updatedAt: now })
        .where(
          and(
            eq(sessionProcesses.sealantWorkspaceId, workspaceId),
            isNull(sessionProcesses.exitedAt),
            ...(kind === undefined ? [] : [eq(sessionProcesses.kind, kind)]),
          ),
        )
        .returning({ sessionId: sessionProcesses.sessionId })
        .pipe(Effect.orDie);
      for (const sessionId of new Set(rows.map((row) => row.sessionId))) {
        yield* notify(sessionId);
      }
    });

    return {
      create,
      byId,
      byLaunchCorrelation,
      listForSession,
      listForService,
      listLiveForWorkspace,
      listLive,
      listRecentServices,
      setStatus,
      setLabel,
      setHostPort,
      setSealantSessionId,
      markExited,
      reapLiveForWorkspace,
    };
  }),
);

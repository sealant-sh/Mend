import {
  CheckpointsRepo,
  ProjectNotFoundError,
  ProjectsRepo,
  SessionChangesRepo,
  SessionNotFoundError,
  SessionsRepo,
} from "@mend/db";
import { SealantRunId, SealantWorkspaceId, SessionId, type ProjectId } from "@mend/domain";
import type { Checkpoint, CheckpointTrigger, Session } from "@mend/domain/workbench";
import { SealantClient, SealantPlatformError } from "@mend/sealant";
import { GitError, Store, worktreePathOf } from "@mend/store";
import type { Harness, Run as SdkRun, WorkspaceCredentialsOptions } from "@sealant/sdk";
import { claudeCode, codex, opencode } from "@sealant/sdk";
import { Effect, Layer, Stream } from "effect";
import * as Context from "effect/Context";

export interface ProvisionInput {
  readonly projectId: ProjectId;
  readonly harness: string;
  readonly label: string | null;
  /** Branch or sha to base the worktree on; null = the project's default branch. */
  readonly base: string | null;
}

/**
 * The workbench session engine (plan §7.2, M1) — the supervisor extracted from
 * the queue-era run starter (docs/M0-INVENTORY.md), rewired onto sessions and
 * the central store:
 *
 * - `provision` creates the worktree, the session row, checkpoint 0
 *   (`session-start`), and the session's change row.
 * - `attachRun` binds an already-started Sealant run and forks supervision:
 *   record stream → last-seen sequence → progress events → settle →
 *   checkpoint. Launching the run is the caller's job — today that is a
 *   prompt-shaped harness run; when the platform ships store mounts and the
 *   interactive PTY surface (PLATFORM-FEEDBACK.md 2026-07-25) the launcher
 *   changes and supervision does not.
 * - `resume` re-attaches every unsettled session after a crash/restart from
 *   its stored sequence. Runs at layer construction.
 *
 * Fibers fork into the layer scope, so they live as long as the process.
 */
export class SessionEngine extends Context.Service<
  SessionEngine,
  {
    readonly provision: (
      input: ProvisionInput,
    ) => Effect.Effect<Session, ProjectNotFoundError | GitError>;
    readonly attachRun: (
      sessionId: SessionId,
      sealantRunId: SealantRunId,
      workspaceId: SealantWorkspaceId,
    ) => Effect.Effect<void, SessionNotFoundError>;
    /**
     * The supervised launch (SDK 0.7.0): a workspace mounting the session's
     * worktree, an interactive PTY session running `argv` inside it, and
     * supervision attached — the record begins here.
     */
    readonly launch: (
      sessionId: SessionId,
      argv: ReadonlyArray<string>,
    ) => Effect.Effect<Session, SessionNotFoundError | ProjectNotFoundError | SealantPlatformError>;
    /** Snapshot the worktree now — review-open and user-mark come through here. */
    readonly checkpointNow: (
      sessionId: SessionId,
      trigger: CheckpointTrigger,
    ) => Effect.Effect<Checkpoint, SessionNotFoundError | ProjectNotFoundError | GitError>;
    /** The user's stop: settle the row; the platform stop follows when the SDK ships it. */
    readonly stop: (sessionId: SessionId) => Effect.Effect<void, SessionNotFoundError>;
  }
>()("@mend/sessions/SessionEngine") {
  static readonly layer = Layer.effect(
    SessionEngine,
    Effect.gen(function* () {
      const sealant = yield* SealantClient;
      const sessions = yield* SessionsRepo;
      const projects = yield* ProjectsRepo;
      const changes = yield* SessionChangesRepo;
      const checkpoints = yield* CheckpointsRepo;
      const store = yield* Store;
      const scope = yield* Effect.scope;

      /** The session's worktree path, derived — never stored twice. */
      const worktreeOf = Effect.fn("SessionEngine.worktreeOf")(function* (session: Session) {
        const project = yield* projects.byId(session.projectId);
        return worktreePathOf(project.storePath, session.worktree);
      });

      const takeCheckpoint = Effect.fn("SessionEngine.takeCheckpoint")(function* (
        session: Session,
        trigger: CheckpointTrigger,
        seq: bigint,
      ) {
        const worktree = yield* worktreeOf(session);
        const previous = yield* checkpoints.latestForSession(session.id);
        const index = yield* checkpoints.countForSession(session.id);
        const snapshot = yield* store.checkpoint(
          worktree,
          session.id,
          index,
          previous?.sha ?? null,
        );
        return yield* checkpoints.create({
          sessionId: session.id,
          ref: snapshot.ref,
          sha: snapshot.sha,
          seq,
          trigger,
        });
      });

      /** A checkpoint that cannot be taken is a gap, carried as content — never a crash. */
      const tryCheckpoint = (session: Session, trigger: CheckpointTrigger, seq: bigint) =>
        takeCheckpoint(session, trigger, seq).pipe(
          Effect.catch((error) =>
            Effect.logWarning("session engine: checkpoint failed").pipe(
              Effect.annotateLogs({ sessionId: session.id, trigger, error: String(error) }),
              Effect.as(null),
            ),
          ),
        );

      const refreshChangeHead = Effect.fn("SessionEngine.refreshChangeHead")(function* (
        session: Session,
      ) {
        const change = yield* changes.bySession(session.id);
        if (change === null) return;
        const latest = yield* checkpoints.latestForSession(session.id);
        if (latest !== null) yield* changes.refreshHead(change.id, latest.sha);
      });

      const supervise = Effect.fn("SessionEngine.supervise")(function* (
        session: Session,
        sdkRun: SdkRun,
        from: bigint,
      ) {
        yield* sealant.recordStream(sdkRun, { from }).pipe(
          Stream.tap((entry) =>
            Effect.gen(function* () {
              yield* sessions.saveLastSeenSequence(session.id, entry.sequence);
              yield* sessions.notifyProgress(session.id, entry.sequence, entry.summary);
            }),
          ),
          Stream.runDrain,
          // A broken stream is not a settled session — the wait below decides.
          Effect.catch((error) =>
            Effect.logWarning("session engine: record stream failed").pipe(
              Effect.annotateLogs({ sessionId: session.id, error: error.message }),
            ),
          ),
        );

        const settled = yield* sealant.waitRun(sdkRun);
        const outcome = settled.result.outcome === "completed" ? "completed" : "failed";
        const summary =
          settled.result.summary ??
          (outcome === "failed" ? `harness exited with code ${settled.result.exitCode}` : null);
        yield* sessions.settle(session.id, outcome, summary);

        // The settle boundary is a turn boundary: snapshot, then let the
        // change row's head follow the snapshot.
        const current = yield* sessions.byId(session.id).pipe(Effect.orElseSucceed(() => session));
        const seq = current.lastSeenSequence;
        yield* tryCheckpoint(current, "turn-boundary", seq);
        yield* refreshChangeHead(current).pipe(Effect.ignore);
      });

      const forkSupervision = (session: Session, sdkRun: SdkRun, from: bigint) =>
        Effect.forkIn(
          supervise(session, sdkRun, from).pipe(
            Effect.catchTag("SealantPlatformError", (error) =>
              sessions.settle(session.id, "failed", error.message),
            ),
            Effect.catchDefect((defect) =>
              sessions.settle(session.id, "failed", `supervision died: ${String(defect)}`),
            ),
          ),
          scope,
        );

      const provision = Effect.fn("SessionEngine.provision")(function* (input: ProvisionInput) {
        const project = yield* projects.byId(input.projectId);
        const sessionId = SessionId.make(crypto.randomUUID());
        const worktree = yield* store.createWorktree(project.storePath, sessionId, input.base);
        const session = yield* sessions.create({
          id: sessionId,
          projectId: project.id,
          harness: input.harness,
          label: input.label,
          worktree: worktree.name,
          branch: worktree.branch,
          baseSha: worktree.baseSha,
          contextSnapshotId: null,
        });
        yield* tryCheckpoint(session, "session-start", 0n);
        yield* changes.ensureForSession(project.id, session.id, worktree.branch, worktree.baseSha);
        return session;
      });

      const attachRun = Effect.fn("SessionEngine.attachRun")(function* (
        sessionId: SessionId,
        sealantRunId: SealantRunId,
        workspaceId: SealantWorkspaceId,
      ) {
        const session = yield* sessions.byId(sessionId);
        yield* sessions.setSealantIds(sessionId, sealantRunId, workspaceId);
        yield* sessions.setStatus(sessionId, "running");
        const work = Effect.gen(function* () {
          const sdkRun = yield* sealant.getRun(sealantRunId);
          yield* supervise(session, sdkRun, 0n);
        }).pipe(
          Effect.catchTag("SealantPlatformError", (error) =>
            sessions.settle(sessionId, "failed", error.message),
          ),
          Effect.catchDefect((defect) =>
            sessions.settle(sessionId, "failed", `supervision died: ${String(defect)}`),
          ),
        );
        yield* Effect.forkIn(work, scope);
      });

      /** Credentials ride connected accounts (references only); harness picks image behavior. */
      const platformShape = (
        harness: string,
      ): { harness: Harness; credentials: WorkspaceCredentialsOptions | undefined } => {
        switch (harness) {
          case "codex":
            return { harness: codex(), credentials: { codex: true } };
          case "claude":
            return { harness: claudeCode(), credentials: { claude: true } };
          default:
            return { harness: opencode(), credentials: undefined };
        }
      };

      const launch = Effect.fn("SessionEngine.launch")(function* (
        sessionId: SessionId,
        argv: ReadonlyArray<string>,
      ) {
        const session = yield* sessions.byId(sessionId);
        const project = yield* projects.byId(session.projectId);
        const worktree = worktreePathOf(project.storePath, session.worktree);
        const shape = platformShape(session.harness);
        const workspace = yield* sealant.createWorkspace({
          source: { kind: "mount", path: worktree },
          harness: shape.harness,
          name: `mend-${session.id.slice(0, 8)}`,
          // Deliberately NOT passing shape.credentials: the 0.7.0 worker's
          // blueprint parser rejects `credentials` on mount-sourced workspaces
          // ("Unrecognized key") and the whole build fails — see
          // PLATFORM-FEEDBACK.md. Harness auth is interactive in the PTY until
          // that lands; restore `credentials: shape.credentials` then.
        });
        const pty = yield* sealant.openSession(workspace, argv);
        yield* sessions.setSealantIds(
          sessionId,
          SealantRunId.make(pty.runId),
          SealantWorkspaceId.make(workspace.id),
        );
        yield* sessions.setSealantSessionId(sessionId, pty.id);
        yield* sessions.setStatus(sessionId, "running");
        const sdkRun = yield* sealant.getRun(pty.runId);
        yield* forkSupervision(session, sdkRun, 0n);

        // The run heartbeats past the PTY's exit (the workspace stays warm), so
        // settle on the SESSION's lifecycle: poll status until it leaves
        // `running`, then settle + checkpoint — unless supervision already did.
        const watchPty = Effect.gen(function* () {
          for (;;) {
            yield* Effect.sleep("2 seconds");
            const status = yield* Effect.tryPromise({
              try: () => pty.status(),
              catch: (cause) =>
                new SealantPlatformError({
                  code: "session_status_failed",
                  status: null,
                  message: "session status failed",
                  cause,
                }),
            });
            if (status.status === "running") continue;
            const current = yield* sessions.byId(sessionId);
            if (current.settledAt !== null) return;
            const outcome =
              status.exitCode === undefined || status.exitCode === 0 ? "completed" : "failed";
            yield* sessions.settle(
              sessionId,
              outcome,
              status.exitCode === undefined ? null : `exited with code ${status.exitCode}`,
            );
            const settled = yield* sessions.byId(sessionId);
            yield* tryCheckpoint(settled, "turn-boundary", settled.lastSeenSequence);
            yield* refreshChangeHead(settled).pipe(Effect.ignore);
            return;
          }
        }).pipe(
          Effect.catchTag("SessionNotFoundError", () => Effect.void),
          Effect.catchTag("SealantPlatformError", (error) =>
            Effect.logWarning("session engine: pty watch failed").pipe(
              Effect.annotateLogs({ sessionId, error: error.message }),
            ),
          ),
        );
        yield* Effect.forkIn(watchPty, scope);
        return yield* sessions.byId(sessionId);
      });

      const checkpointNow = Effect.fn("SessionEngine.checkpointNow")(function* (
        sessionId: SessionId,
        trigger: CheckpointTrigger,
      ) {
        const session = yield* sessions.byId(sessionId);
        const checkpoint = yield* takeCheckpoint(session, trigger, session.lastSeenSequence);
        yield* refreshChangeHead(session).pipe(Effect.ignore);
        return checkpoint;
      });

      const stop = Effect.fn("SessionEngine.stop")(function* (sessionId: SessionId) {
        const session = yield* sessions.byId(sessionId);
        yield* sessions.settle(sessionId, "stopped", null);
        yield* tryCheckpoint(session, "user-mark", session.lastSeenSequence);
        yield* refreshChangeHead(session).pipe(Effect.ignore);
      });

      /** Re-attach to sessions that were live when the last process died. */
      const resume = Effect.fn("SessionEngine.resume")(function* () {
        const unsettled = yield* sessions.listUnsettled();
        for (const session of unsettled) {
          if (session.sealantRunId === null) {
            yield* sessions.settle(
              session.id,
              "failed",
              "process restarted before the harness started",
            );
            continue;
          }
          const sealantRunId = session.sealantRunId;
          const work = Effect.gen(function* () {
            const sdkRun = yield* sealant.getRun(sealantRunId);
            yield* supervise(session, sdkRun, session.lastSeenSequence);
          }).pipe(
            Effect.catchTag("SealantPlatformError", (error) =>
              sessions.settle(session.id, "failed", error.message),
            ),
            Effect.catchDefect((defect) =>
              sessions.settle(session.id, "failed", `supervision died: ${String(defect)}`),
            ),
          );
          yield* Effect.forkIn(work, scope);
          yield* Effect.logInfo("session engine: re-attached").pipe(
            Effect.annotateLogs({
              sessionId: session.id,
              from: String(session.lastSeenSequence),
            }),
          );
        }
      });

      yield* resume();

      return { provision, attachRun, launch, checkpointNow, stop };
    }),
  );
}

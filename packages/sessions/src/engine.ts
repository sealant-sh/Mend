import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  CheckpointsRepo,
  ProjectMountsRepo,
  ProjectNotFoundError,
  ProjectsRepo,
  ReferencesRepo,
  SessionChangesRepo,
  SessionNotFoundError,
  SessionRunsRepo,
  SessionsRepo,
} from "@mend/db";
import { SealantRunId, SealantWorkspaceId, SessionId, type ProjectId } from "@mend/domain";
import type { Checkpoint, CheckpointTrigger, Session, SessionRun } from "@mend/domain/workbench";
import { SessionExtraMount, SessionReferenceMount } from "@mend/domain/workbench";
import { SealantClient, SealantPlatformError } from "@mend/sealant";
import { GitError, Store, sessionStatePathOf, worktreePathOf } from "@mend/store";
import type { Harness, Run as SdkRun, WorkspaceCredentialsOptions } from "@sealant/sdk";
import { claudeCode, codex, opencode } from "@sealant/sdk";
import { Duration, Effect, Layer, Schedule, Stream } from "effect";
import * as Context from "effect/Context";

import {
  HARNESS_STATE,
  HarnessStateCommandError,
  type HarnessStateError,
  HarnessStateIOError,
  HarnessStateInvalidError,
  distillOpeningPrompt,
  extractTranscript,
  nativeResumeArgv,
  type HarnessStateManifest,
  readHarnessStateManifest,
} from "./harness-state.ts";
import {
  convertNativeSession,
  ingestNativeSession,
  type ConvertedNativeSession,
} from "./native-convert.ts";

/** How a harness takes an opening prompt (the cross-harness handoff). */
const promptArgv = (harness: string, prompt: string): ReadonlyArray<string> | null => {
  switch (harness) {
    case "claude":
      return ["claude", prompt];
    case "codex":
      return ["codex", prompt];
    default:
      return null;
  }
};

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

/**
 * Permission prompts are the harness re-asking a question Mend already
 * answers: the session runs in an isolated workspace on its own
 * worktree, every byte is recorded, and nothing lands without review.
 * Default every harness to its bypass mode; a caller that passes the
 * flag itself (or a contrary one) is left alone.
 */
const withPermissionDefaults = (
  harness: string,
  argv: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const [head, ...rest] = argv;
  if (harness === "claude" && head === "claude" && !argv.includes("--permission-mode")) {
    return argv.includes("--dangerously-skip-permissions")
      ? argv
      : ["claude", "--dangerously-skip-permissions", ...rest];
  }
  if (harness === "codex" && head === "codex" && !argv.includes("--sandbox")) {
    return argv.includes("--dangerously-bypass-approvals-and-sandbox")
      ? argv
      : ["codex", "--dangerously-bypass-approvals-and-sandbox", ...rest];
  }
  return argv;
};

/**
 * "Could not reach the platform" is not "the run is over". Only a
 * control-plane answer that the run no longer exists settles a session from
 * the supervision path; everything else — a wrong SEALANT_BASE_URL, a control
 * plane mid-upgrade, a network blip — leaves the session alone and retries,
 * so a misconfigured or briefly-blind server can never destroy live work it
 * didn't start.
 */
const runIsGone = (error: SealantPlatformError) => error.status === 404 || error.status === 410;

const SUPERVISE_RETRY = Schedule.exponential("1 second").pipe(
  Schedule.modifyDelay((_, delay) =>
    Effect.succeed(Duration.min(Duration.fromInputUnsafe(delay), Duration.seconds(30))),
  ),
);

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
    ) => Effect.Effect<
      Session,
      SessionNotFoundError | ProjectNotFoundError | SealantPlatformError | HarnessStateError
    >;
    /** Snapshot the worktree now — review-open and user-mark come through here. */
    readonly checkpointNow: (
      sessionId: SessionId,
      trigger: CheckpointTrigger,
    ) => Effect.Effect<Checkpoint, SessionNotFoundError | ProjectNotFoundError | GitError>;
    /** The user's stop: settle the row; the platform stop follows when the SDK ships it. */
    readonly stop: (sessionId: SessionId) => Effect.Effect<void, SessionNotFoundError>;
    /**
     * Rejoin a session as a continuous piece of work — harness- and
     * machine-agnostic. Same worktree, same change, same conversation: the
     * fresh workspace restores the saved harness state (a claude resume is
     * NATIVE, memory intact); resuming WITH a different harness carries the
     * conversation across as a distilled opening prompt (text is the
     * interchange format — native state never crosses harnesses).
     */
    readonly resumeSession: (
      sessionId: SessionId,
      harness: string | null,
    ) => Effect.Effect<
      Session,
      SessionNotFoundError | ProjectNotFoundError | SealantPlatformError | HarnessStateError
    >;
    /**
     * The session's conversation as the canonical record — read LIVE from the
     * running workspace's harness state (or from the store once settled).
     * The chat surfaces render this; the terminal stays the raw view.
     */
    readonly transcript: (sessionId: SessionId) => Effect.Effect<
      {
        readonly sourceHarness: string;
        readonly events: ReadonlyArray<import("./native-convert.ts").CanonicalEvent>;
      },
      SessionNotFoundError
    >;
  }
>()("@mend/sessions/SessionEngine") {
  static readonly layer = Layer.effect(
    SessionEngine,
    Effect.gen(function* () {
      const sealant = yield* SealantClient;
      const sessions = yield* SessionsRepo;
      const sessionRuns = yield* SessionRunsRepo;
      const projects = yield* ProjectsRepo;
      const changes = yield* SessionChangesRepo;
      const checkpoints = yield* CheckpointsRepo;
      const references = yield* ReferencesRepo;
      const projectMounts = yield* ProjectMountsRepo;
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
        cursor: { readonly sealantRunId: SealantRunId | null; readonly sequence: bigint },
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
          sealantRunId: cursor.sealantRunId,
          seq: cursor.sequence,
          trigger,
        });
      });

      /** A checkpoint that cannot be taken is a gap, carried as content — never a crash. */
      const tryCheckpoint = (
        session: Session,
        trigger: CheckpointTrigger,
        cursor: { readonly sealantRunId: SealantRunId | null; readonly sequence: bigint },
      ) =>
        takeCheckpoint(session, trigger, cursor).pipe(
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
        sessionRun: SessionRun,
        sdkRun: SdkRun,
      ) {
        yield* sealant.recordStream(sdkRun, { from: sessionRun.lastSeenSequence }).pipe(
          Stream.tap((entry) =>
            Effect.gen(function* () {
              yield* sessionRuns.saveLastSeenSequence(sessionRun.sealantRunId, entry.sequence);
              // Denormalized latest-run progress for existing list/UI contracts only. Supervision
              // never reads this session-level mirror.
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
        yield* sessionRuns.settle(sessionRun.sealantRunId, outcome, summary);
        yield* sessions.settle(session.id, outcome, summary);

        // The settle boundary is a turn boundary: snapshot, then let the
        // change row's head follow the snapshot.
        const current = yield* sessions.byId(session.id).pipe(Effect.orElseSucceed(() => session));
        const currentRun = yield* sessionRuns.bySealantRunId(sessionRun.sealantRunId);
        yield* tryCheckpoint(current, "turn-boundary", {
          sealantRunId: sessionRun.sealantRunId,
          sequence: currentRun?.lastSeenSequence ?? sessionRun.lastSeenSequence,
        });
        yield* refreshChangeHead(current).pipe(Effect.ignore);
        yield* sweepWorkspace(session.id);
      });

      /** Supervise a session's run for as long as this process lives. */
      const superviseExisting = (sessionId: SessionId, sealantRunId: SealantRunId) =>
        Effect.gen(function* () {
          const current = yield* sessions.byId(sessionId);
          if (current.settledAt !== null) return;
          const sessionRun = yield* sessionRuns.bySealantRunId(sealantRunId);
          if (sessionRun === null) {
            yield* sessions.settle(
              sessionId,
              "failed",
              `run ${sealantRunId} is missing from the session record index`,
            );
            return;
          }
          const sdkRun = yield* sealant.getRun(sealantRunId);
          yield* supervise(current, sessionRun, sdkRun);
        }).pipe(
          Effect.tapError((error) =>
            Effect.logWarning("session engine: supervision interrupted; retrying").pipe(
              Effect.annotateLogs({ sessionId, error: error.message }),
            ),
          ),
          Effect.retry({
            while: (error) => error instanceof SealantPlatformError && !runIsGone(error),
            schedule: SUPERVISE_RETRY,
          }),
          Effect.catchTag("SealantPlatformError", (error) =>
            sessions
              .settle(sessionId, "failed", error.message)
              .pipe(Effect.andThen(sweepWorkspace(sessionId))),
          ),
          Effect.catchTag("SessionNotFoundError", () => Effect.void),
          Effect.catchDefect((defect) =>
            sessions
              .settle(sessionId, "failed", `supervision died: ${String(defect)}`)
              .pipe(Effect.andThen(sweepWorkspace(sessionId))),
          ),
        );

      const forkSupervision = (sessionId: SessionId, sealantRunId: SealantRunId) =>
        Effect.forkIn(superviseExisting(sessionId, sealantRunId), scope);

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
        yield* tryCheckpoint(session, "session-start", { sealantRunId: null, sequence: 0n });
        yield* changes.ensureForSession(project.id, session.id, worktree.branch, worktree.baseSha);
        return session;
      });

      const attachRun = Effect.fn("SessionEngine.attachRun")(function* (
        sessionId: SessionId,
        sealantRunId: SealantRunId,
        workspaceId: SealantWorkspaceId,
      ) {
        const session = yield* sessions.byId(sessionId);
        const existing = yield* sessionRuns.bySealantRunId(sealantRunId);
        if (existing === null) {
          yield* sessionRuns.create({
            sessionId,
            harness: session.harness,
            sealantRunId,
            sealantWorkspaceId: workspaceId,
            sealantSessionId: null,
          });
        }
        yield* sessions.setSealantIds(sessionId, sealantRunId, workspaceId);
        yield* sessions.setStatus(sessionId, "running");
        yield* forkSupervision(sessionId, sealantRunId);
      });

      /**
       * Interactive Claude Code ignores the platform's env-injected credential
       * during onboarding: `claude -p` honors `CLAUDE_CODE_OAUTH_TOKEN`, but
       * the TUI's first-run flow still demands a login until `~/.claude.json`
       * marks onboarding complete and `~/.claude/.credentials.json` exists.
       * Seed both from the injected env before exec'ing the real argv — only
       * when the token is present and no state file exists yet, so a real
       * login is never clobbered. Filed as platform feedback: the claude
       * injection should be file-kind, like codex's `auth.json`.
       */
      // A MERGE, not an exists-guard: a restored session brings back claude's
      // own rewritten `.claude.json` (which knows nothing of these flags), so
      // the seed must re-assert them on every launch while preserving whatever
      // state came back. Pre-answered dialogs: onboarding, bypass acceptance,
      // and the /workspace/repo trust — the user made the trust decision when
      // they adopted the repo, and bypass is Mend's stance (the workspace is
      // the sandbox).
      const CLAUDE_ONBOARDING_SEED =
        `node -e '` +
        `const fs=require("fs"),os=require("os"),h=os.homedir(),t=process.env.CLAUDE_CODE_OAUTH_TOKEN;` +
        `fs.mkdirSync(h+"/.claude",{recursive:true});` +
        `if(t&&!fs.existsSync(h+"/.claude/.credentials.json")){` +
        `fs.writeFileSync(h+"/.claude/.credentials.json",JSON.stringify({claudeAiOauth:{accessToken:t,refreshToken:"",expiresAt:9999999999999,scopes:["user:inference","user:profile"],subscriptionType:"max"}}),{mode:0o600})}` +
        `let c={};try{c=JSON.parse(fs.readFileSync(h+"/.claude.json","utf8"))}catch{}` +
        `c.hasCompletedOnboarding=true;c.bypassPermissionsModeAccepted=true;` +
        `c.projects=c.projects||{};` +
        `c.projects["/workspace/repo"]=Object.assign({},c.projects["/workspace/repo"],{hasTrustDialogAccepted:true,hasCompletedProjectOnboarding:true});` +
        `fs.writeFileSync(h+"/.claude.json",JSON.stringify(c));` +
        // The bypass-acceptance dialog is actually gated on settings.json
        // (verified: accepting it writes exactly this key), not .claude.json.
        `let s={};try{s=JSON.parse(fs.readFileSync(h+"/.claude/settings.json","utf8"))}catch{}` +
        `s.skipDangerousModePermissionPrompt=true;` +
        // The workspace image never sees the operator's own ~/.claude
        // settings, so a fresh session silently falls back to the CLI's
        // default model. Default-if-absent only: a restored session's own
        // choice (or a mid-session /model) survives the merge.
        `s.model=s.model||"claude-fable-5";` +
        `fs.writeFileSync(h+"/.claude/settings.json",JSON.stringify(s))' 2>/dev/null; ` +
        // The workspace IS the sandbox: Claude Code refuses bypass-permissions
        // as root unless the environment says so, and it is telling the truth.
        `export IS_SANDBOX=1; ` +
        `exec "$@"`;

      const withHarnessBootstrap = (
        harness: string,
        argv: ReadonlyArray<string>,
      ): ReadonlyArray<string> => {
        const shaped = withPermissionDefaults(harness, argv);
        if (harness === "claude") return ["sh", "-c", CLAUDE_ONBOARDING_SEED, "sh", ...shaped];
        if (harness === "codex") return ["sh", "-c", CODEX_TRUST_SEED, "sh", ...shaped];
        return shaped;
      };

      // Codex's per-project trust prompt, pre-answered the same way: the user
      // made the trust decision when they adopted the repo.
      const CODEX_TRUST_SEED =
        `mkdir -p "$HOME/.codex"; ` +
        `grep -q 'workspace/repo' "$HOME/.codex/config.toml" 2>/dev/null || ` +
        `printf '[projects."/workspace/repo"]\ntrust_level = "trusted"\n' >> "$HOME/.codex/config.toml"; ` +
        `exec "$@"`;

      // ─── the harness session store (automatic; see harness-state.ts) ──────

      /**
       * Pull the harness's raw native state out of the still-warm workspace
       * into the central store, plus the primary transcript and the provider
       * session id a native resume needs. Runs at every settle; must never
       * break a settle path (callers go through `tryHarvest`).
       */
      const harvestHarnessState = Effect.fn("SessionEngine.harvestHarnessState")(function* (
        sessionId: SessionId,
      ) {
        const session = yield* sessions.byId(sessionId);
        const shape = HARNESS_STATE[session.harness];
        if (shape === undefined || session.sealantWorkspaceId === null) return;
        const project = yield* projects.byId(session.projectId);
        const stateDir = sessionStatePathOf(project.storePath, session.id);
        const workspace = yield* sealant.getWorkspace(session.sealantWorkspaceId);

        yield* Effect.tryPromise({
          try: () => fs.mkdir(stateDir, { recursive: true }),
          catch: (cause) =>
            new HarnessStateIOError({
              sessionId,
              operation: "write-archive",
              path: stateDir,
              message: `Could not create the harness-state directory for session ${sessionId}.`,
              cause,
            }),
        });
        // The manifest is the commit marker. Clear it before capture begins so
        // a failed new harvest can never masquerade as the current state by
        // leaving the previous run's provider session id in place.
        const manifestPath = path.join(stateDir, "manifest.json");
        yield* Effect.tryPromise({
          try: () => fs.rm(manifestPath, { force: true }),
          catch: (cause) =>
            new HarnessStateIOError({
              sessionId,
              operation: "clear-manifest",
              path: manifestPath,
              message: `Could not prepare saved harness state for session ${sessionId}.`,
              cause,
            }),
        });

        const list = shape.paths.map((p) => `"${p}"`).join(" ");
        const pack = yield* sealant.exec(workspace, [
          "sh",
          "-c",
          `cd "$HOME" || exit 1; L=""; for p in ${list}; do [ -e "$p" ] && L="$L $p"; done; ` +
            `[ -n "$L" ] || exit 3; tar -czf /tmp/mend-harness-state.tgz $L && ` +
            `base64 -w0 /tmp/mend-harness-state.tgz`,
        ]);
        if (pack.exitCode !== 0 || pack.stdout.trim() === "") {
          return yield* new HarnessStateCommandError({
            sessionId,
            harness: session.harness,
            operation: "capture-archive",
            exitCode: pack.exitCode,
            stderr: pack.stderr,
            message: `Could not capture ${session.harness} state for session ${sessionId}.`,
          });
        }
        const archivePath = path.join(stateDir, "harness-state.tar.gz");
        yield* Effect.tryPromise({
          try: () => fs.writeFile(archivePath, Buffer.from(pack.stdout.trim(), "base64")),
          catch: (cause) =>
            new HarnessStateIOError({
              sessionId,
              operation: "write-archive",
              path: archivePath,
              message: `Could not save ${session.harness} state for session ${sessionId}.`,
              cause,
            }),
        });

        const located = yield* sealant.exec(workspace, ["sh", "-c", shape.latestTranscript]);
        const transcriptFile = located.stdout.trim().split("\n")[0] ?? "";
        let providerSessionId: string | null = null;
        if (
          (session.harness === "claude" || session.harness === "codex") &&
          (located.exitCode !== 0 || transcriptFile === "")
        ) {
          return yield* new HarnessStateCommandError({
            sessionId,
            harness: session.harness,
            operation: "locate-transcript",
            exitCode: located.exitCode,
            stderr: located.stderr,
            message: `Captured ${session.harness} state but could not locate its transcript for session ${sessionId}.`,
          });
        }
        if (located.exitCode === 0 && transcriptFile !== "") {
          providerSessionId = shape.providerSessionId(transcriptFile);
          if (
            (session.harness === "claude" || session.harness === "codex") &&
            providerSessionId === null
          ) {
            return yield* new HarnessStateCommandError({
              sessionId,
              harness: session.harness,
              operation: "identify-session",
              exitCode: 0,
              stderr: "",
              message: `Could not identify the native ${session.harness} session in ${transcriptFile}.`,
            });
          }
          const native = yield* sealant.exec(workspace, ["cat", transcriptFile]);
          if (native.exitCode !== 0 || native.stdout === "") {
            return yield* new HarnessStateCommandError({
              sessionId,
              harness: session.harness,
              operation: "read-transcript",
              exitCode: native.exitCode,
              stderr: native.stderr,
              message: `Could not read the ${session.harness} transcript for session ${sessionId}.`,
            });
          }
          const transcriptPath = path.join(stateDir, "transcript.native");
          yield* Effect.tryPromise({
            try: () => fs.writeFile(transcriptPath, native.stdout),
            catch: (cause) =>
              new HarnessStateIOError({
                sessionId,
                operation: "write-transcript",
                path: transcriptPath,
                message: `Could not save the ${session.harness} transcript for session ${sessionId}.`,
                cause,
              }),
          });
          // The harness-agnostic record IS the durable artifact; native
          // files are views. Adapters re-emit any supported harness from it.
          const canonical = ingestNativeSession(session.harness, native.stdout, "/workspace/repo");
          if (canonical !== null) {
            const canonicalPath = path.join(stateDir, "session.canonical.json");
            yield* Effect.tryPromise({
              try: () => fs.writeFile(canonicalPath, JSON.stringify(canonical, null, 2)),
              catch: (cause) =>
                new HarnessStateIOError({
                  sessionId,
                  operation: "write-canonical",
                  path: canonicalPath,
                  message: `Could not save the canonical transcript for session ${sessionId}.`,
                  cause,
                }),
            });
          }
        }

        const manifest: HarnessStateManifest = {
          harness: session.harness,
          providerSessionId,
          capturedAt: new Date().toISOString(),
        };
        yield* Effect.tryPromise({
          try: () => fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2)),
          catch: (cause) =>
            new HarnessStateIOError({
              sessionId,
              operation: "write-manifest",
              path: manifestPath,
              message: `Could not commit saved harness state for session ${sessionId}.`,
              cause,
            }),
        });
        if (providerSessionId !== null) {
          yield* sessions.setProviderSessionId(session.id, providerSessionId);
        }
      });

      /** Containers die when the work settles — after harvest, best-effort. */
      const stopWorkspaceQuietly = (sessionId: SessionId) =>
        Effect.gen(function* () {
          const session = yield* sessions.byId(sessionId);
          if (session.sealantWorkspaceId === null) return;
          const workspace = yield* sealant.getWorkspace(session.sealantWorkspaceId);
          yield* sealant.stopWorkspace(workspace);
        }).pipe(
          Effect.catch((error) =>
            Effect.logWarning("session engine: workspace stop failed").pipe(
              Effect.annotateLogs({ sessionId, error: String(error) }),
            ),
          ),
        );

      const tryHarvest = (sessionId: SessionId) =>
        harvestHarnessState(sessionId).pipe(
          Effect.catch((error) =>
            Effect.logWarning("session engine: harness-state harvest failed").pipe(
              Effect.annotateLogs({ sessionId, error: String(error) }),
            ),
          ),
        );

      /** The tail of every settle path: harvest, then reap. Both halves quiet. */
      const sweepWorkspace = (sessionId: SessionId) =>
        tryHarvest(sessionId).pipe(Effect.andThen(stopWorkspaceQuietly(sessionId)));

      const launchInternal = Effect.fn("SessionEngine.launchInternal")(function* (
        sessionId: SessionId,
        argv: ReadonlyArray<string>,
        nativeImport: ConvertedNativeSession | null,
        manifestOverride?: HarnessStateManifest,
      ) {
        const session = yield* sessions.byId(sessionId);
        const project = yield* projects.byId(session.projectId);
        const worktree = worktreePathOf(project.storePath, session.worktree);
        const shape = platformShape(session.harness);
        const stateDir = sessionStatePathOf(project.storePath, session.id);
        const manifest =
          manifestOverride ??
          (yield* readHarnessStateManifest(stateDir, session.id).pipe(
            Effect.catchTag("HarnessStateNotFoundError", (error) =>
              session.sealantRunId === null ? Effect.succeed(null) : Effect.fail(error),
            ),
          ));
        // What rides beside the worktree (plan §17, 2026-08-01): selected
        // references read-only at /workspace/ref/<name>, and the project's
        // declared host folders at /workspace/home/<name> — read-only unless
        // deliberately chosen otherwise. Resolved at launch; the session
        // records exactly what it received.
        const selectedReferences = yield* references
          .listForProject(project.id)
          .pipe(Effect.orElseSucceed(() => []));
        const declaredMounts = yield* projectMounts
          .listForProject(project.id)
          .pipe(Effect.orElseSucceed(() => []));
        const workspaceMounts = [
          ...selectedReferences.map((reference) => ({
            hostPath: reference.path,
            mountPath: `/workspace/ref/${reference.name}`,
          })),
          ...declaredMounts.map((mount) => ({
            hostPath: mount.hostPath,
            mountPath: `/workspace/home/${mount.name}`,
            // Omitted = the blueprint default (read-only). Only rw is explicit.
            ...(mount.readOnly ? {} : { readOnly: false }),
          })),
        ];
        // A failed provision settles the session — fire-and-forget launchers
        // (the web) must never strand a row in "starting" with no error.
        const settleOnFailure = <A>(effect: Effect.Effect<A, SealantPlatformError>) =>
          effect.pipe(
            Effect.tapError((error) =>
              sessions
                .settle(sessionId, "failed", `launch failed: ${error.message}`)
                .pipe(Effect.ignore),
            ),
          );
        // A relaunch is about to overwrite the row's workspace pointer; stop
        // the previous workspace first or it becomes unaddressable and leaks
        // until the platform TTL.
        if (session.sealantWorkspaceId !== null) {
          yield* stopWorkspaceQuietly(sessionId);
        }
        const createWorkspace = (withCredentials: boolean) =>
          sealant.createWorkspace({
            source: { kind: "mount", path: worktree },
            ...(workspaceMounts.length === 0 ? {} : { mounts: workspaceMounts }),
            harness: shape.harness,
            name: `mend-${session.id.slice(0, 8)}`,
            // Belt for every path that forgets to stop: the platform reaper.
            ttl: "12h",
            // Requires the platform at 0.7.1+ (sealant#114): 0.7.0 dropped every
            // mount create that carried credentials at the worker's blueprint parse.
            ...(withCredentials && shape.credentials !== undefined
              ? { credentials: shape.credentials }
              : {}),
          });
        // BYO harness means a missing connected account degrades to the
        // harness's own interactive auth — it never blocks the launch.
        const workspace = yield* createWorkspace(true)
          .pipe(
            Effect.catchIf(
              (error) => error.message.toLowerCase().includes("connected account"),
              (error) =>
                Effect.logWarning("session engine: launching without injected credentials").pipe(
                  Effect.annotateLogs({ sessionId, error: error.message }),
                  Effect.andThen(createWorkspace(false)),
                ),
            ),
          )
          .pipe(settleOnFailure);

        // A relaunch restores the harness's own saved state into the fresh
        // workspace before the harness starts, and — where the harness
        // supports it — turns the launch into a NATIVE resume. Automatic:
        // state was harvested at the previous settle, nothing was asked of
        // the user. Cross-harness state never restores; that path goes
        // through the transcript adapters instead.
        let shapedArgv = argv;
        if (manifest !== null && manifest.harness === session.harness) {
          const tarName = `.mend-harness-state-${session.id.slice(0, 8)}.tgz`;
          const archivePath = path.join(stateDir, "harness-state.tar.gz");
          const stagedPath = path.join(worktree, tarName);
          const restore = Effect.tryPromise({
            try: () => fs.copyFile(archivePath, stagedPath),
            catch: (cause) =>
              new HarnessStateIOError({
                sessionId,
                operation: "stage-archive",
                path: archivePath,
                message: `Could not stage saved ${session.harness} state for session ${sessionId}.`,
                cause,
              }),
          }).pipe(
            Effect.andThen(
              sealant.exec(workspace, [
                "sh",
                "-c",
                `tar -xzf "/workspace/repo/${tarName}" -C "$HOME"; ` +
                  `code=$?; rm -f "/workspace/repo/${tarName}"; exit $code`,
              ]),
            ),
            Effect.flatMap((result) =>
              result.exitCode === 0
                ? Effect.void
                : Effect.fail(
                    new HarnessStateCommandError({
                      sessionId,
                      harness: session.harness,
                      operation: "restore-archive",
                      exitCode: result.exitCode,
                      stderr: result.stderr,
                      message: `Could not restore saved ${session.harness} state for session ${sessionId}.`,
                    }),
                  ),
            ),
            // Belt: never leave the staging tarball in the worktree.
            Effect.ensuring(
              Effect.promise(() => fs.rm(stagedPath, { force: true })).pipe(Effect.ignore),
            ),
          );
          yield* restore.pipe(
            Effect.tapError((error) =>
              sessions
                .settle(sessionId, "failed", `resume failed: ${error.message}`)
                .pipe(Effect.andThen(sealant.stopWorkspace(workspace)), Effect.ignore),
            ),
          );
          shapedArgv = nativeResumeArgv(session.harness, manifest.providerSessionId, shapedArgv);
        }

        if (nativeImport !== null) {
          // Cross-harness open: place the CONVERTED native session into the
          // fresh workspace's $HOME so the target harness resumes it as its
          // own — full history, its own session id, no distillation.
          const importDir = path.join(worktree, ".mend-native-import");
          const importState = Effect.tryPromise({
            try: async () => {
              for (const file of nativeImport.files) {
                const target = path.join(importDir, file.path);
                await fs.mkdir(path.dirname(target), { recursive: true });
                await fs.writeFile(target, file.content);
              }
            },
            catch: (cause) =>
              new HarnessStateIOError({
                sessionId,
                operation: "stage-import",
                path: importDir,
                message: `Could not stage the converted ${session.harness} session state.`,
                cause,
              }),
          }).pipe(
            Effect.andThen(
              sealant.exec(workspace, [
                "sh",
                "-c",
                'cp -a /workspace/repo/.mend-native-import/. "$HOME"/ && rm -rf /workspace/repo/.mend-native-import',
              ]),
            ),
            Effect.flatMap((result) =>
              result.exitCode === 0
                ? Effect.void
                : Effect.fail(
                    new HarnessStateCommandError({
                      sessionId,
                      harness: session.harness,
                      operation: "import-session",
                      exitCode: result.exitCode,
                      stderr: result.stderr,
                      message: `Could not import converted ${session.harness} state for session ${sessionId}.`,
                    }),
                  ),
            ),
            Effect.ensuring(
              Effect.promise(() => fs.rm(importDir, { recursive: true, force: true })).pipe(
                Effect.ignore,
              ),
            ),
          );
          yield* importState.pipe(
            Effect.tapError((error) =>
              sessions
                .settle(sessionId, "failed", `resume failed: ${error.message}`)
                .pipe(Effect.andThen(sealant.stopWorkspace(workspace)), Effect.ignore),
            ),
          );
        }

        if (selectedReferences.length > 0) {
          yield* sessions.setReferenceMounts(
            sessionId,
            selectedReferences.map(
              (reference) =>
                new SessionReferenceMount({
                  name: reference.name,
                  mountPath: `/workspace/ref/${reference.name}`,
                  sha: reference.headSha,
                }),
            ),
          );
        }
        if (declaredMounts.length > 0) {
          yield* sessions.setExtraMounts(
            sessionId,
            declaredMounts.map(
              (mount) =>
                new SessionExtraMount({
                  name: mount.name,
                  hostPath: mount.hostPath,
                  mountPath: `/workspace/home/${mount.name}`,
                  readOnly: mount.readOnly,
                }),
            ),
          );
        }
        if (workspaceMounts.length > 0) {
          // Tell the harness the mounts exist — appended to its global memory
          // file in the workspace $HOME (never the worktree: the note is not
          // review content). After state restore, which rewrites $HOME.
          const referencesSection =
            selectedReferences.length === 0
              ? ""
              : `Read-only clones of dependency sources — read the actual source here ` +
                `before guessing a dependency's API:\n\n` +
                selectedReferences
                  .map((reference) => `- /workspace/ref/${reference.name}`)
                  .join("\n") +
                `\n\n`;
          const foldersSection =
            declaredMounts.length === 0
              ? ""
              : `Project folders from the user's machine:\n\n` +
                declaredMounts
                  .map((mount) =>
                    mount.readOnly
                      ? `- /workspace/home/${mount.name} (read-only)`
                      : `- /workspace/home/${mount.name} (read-write — writes land on the ` +
                        `user's folder directly and are not part of the reviewed change)`,
                  )
                  .join("\n") +
                `\n\n`;
          const note =
            `\n<!-- mend:mounts -->\n## Mend mounts\n\nMounted beside the repo:\n\n` +
            referencesSection +
            foldersSection;
          yield* sealant
            .exec(workspace, [
              "sh",
              "-c",
              `mkdir -p "$HOME/.claude" "$HOME/.codex"; ` +
                `for f in "$HOME/.claude/CLAUDE.md" "$HOME/.codex/AGENTS.md"; do ` +
                `grep -Eq "mend:(mounts|references)" "$f" 2>/dev/null || printf '%s' "$1" >> "$f"; done`,
              "sh",
              note,
            ])
            .pipe(Effect.ignore);
        }

        const pty = yield* sealant
          .openSession(workspace, withHarnessBootstrap(session.harness, shapedArgv))
          .pipe(
            // The workspace exists but its id is not on the row yet — reap it
            // here or it burns until the platform TTL.
            Effect.tapError(() => sealant.stopWorkspace(workspace).pipe(Effect.ignore)),
            settleOnFailure,
          );
        const sealantRunId = SealantRunId.make(pty.runId);
        yield* sessionRuns.create({
          sessionId,
          harness: session.harness,
          sealantRunId,
          sealantWorkspaceId: SealantWorkspaceId.make(workspace.id),
          sealantSessionId: pty.id,
        });
        yield* sessions.setSealantIds(
          sessionId,
          sealantRunId,
          SealantWorkspaceId.make(workspace.id),
        );
        yield* sessions.setSealantSessionId(sessionId, pty.id);
        yield* sessions.setStatus(sessionId, "running");
        yield* forkSupervision(sessionId, sealantRunId);

        // The run heartbeats past the PTY's exit (the workspace stays warm), so
        // settle on the SESSION's lifecycle: poll status until it leaves
        // `running`, then settle + checkpoint — unless supervision already did.
        const watchPty = Effect.gen(function* () {
          // A status error is blindness, not an exit: keep polling. Only an
          // answered poll that says "not running" settles anything — so a
          // control-plane restart mid-session never reads as a crash.
          let blindPolls = 0;
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
            }).pipe(Effect.catchTag("SealantPlatformError", () => Effect.succeed(null)));
            if (status === null) {
              blindPolls += 1;
              if (blindPolls % 30 === 0) {
                yield* Effect.logWarning("session engine: pty status unreachable").pipe(
                  Effect.annotateLogs({ sessionId, blindPolls }),
                );
              }
              continue;
            }
            blindPolls = 0;
            if (status.status === "running") continue;
            const current = yield* sessions.byId(sessionId);
            if (current.settledAt !== null) return;
            const outcome =
              status.exitCode === undefined || status.exitCode === 0 ? "completed" : "failed";
            yield* sessionRuns.settle(
              sealantRunId,
              outcome,
              status.exitCode === undefined ? null : `exited with code ${status.exitCode}`,
            );
            yield* sessions.settle(
              sessionId,
              outcome,
              status.exitCode === undefined ? null : `exited with code ${status.exitCode}`,
            );
            const settled = yield* sessions.byId(sessionId);
            const settledRun = yield* sessionRuns.bySealantRunId(sealantRunId);
            yield* tryCheckpoint(settled, "turn-boundary", {
              sealantRunId,
              sequence: settledRun?.lastSeenSequence ?? 0n,
            });
            yield* refreshChangeHead(settled).pipe(Effect.ignore);
            yield* sweepWorkspace(sessionId);
            return;
          }
        }).pipe(Effect.catchTag("SessionNotFoundError", () => Effect.void));
        yield* Effect.forkIn(watchPty, scope);
        return yield* sessions.byId(sessionId);
      });

      const checkpointNow = Effect.fn("SessionEngine.checkpointNow")(function* (
        sessionId: SessionId,
        trigger: CheckpointTrigger,
      ) {
        const session = yield* sessions.byId(sessionId);
        const latestRun = yield* sessionRuns.latestForSession(sessionId);
        const checkpoint = yield* takeCheckpoint(session, trigger, {
          sealantRunId: latestRun?.sealantRunId ?? null,
          sequence: latestRun?.lastSeenSequence ?? 0n,
        });
        yield* refreshChangeHead(session).pipe(Effect.ignore);
        return checkpoint;
      });

      /** Default argv per harness — what a resume launches. */
      const HARNESS_ARGV: Record<string, ReadonlyArray<string>> = {
        claude: ["claude"],
        codex: ["codex"],
        opencode: ["opencode"],
      };

      const ACTIVE_STATUSES = new Set(["starting", "running", "waiting", "idle"]);

      const transcript = Effect.fn("SessionEngine.transcript")(function* (sessionId: SessionId) {
        const session = yield* sessions.byId(sessionId);
        const shape = HARNESS_STATE[session.harness];
        let native: string | null = null;
        if (
          shape !== undefined &&
          ACTIVE_STATUSES.has(session.status) &&
          session.sealantWorkspaceId !== null
        ) {
          native = yield* Effect.gen(function* () {
            const workspace = yield* sealant.getWorkspace(session.sealantWorkspaceId ?? "");
            const located = yield* sealant.exec(workspace, ["sh", "-c", shape.latestTranscript]);
            const file = located.stdout.trim().split("\n")[0] ?? "";
            if (located.exitCode !== 0 || file === "") return null;
            const read = yield* sealant.exec(workspace, ["cat", file]);
            return read.exitCode === 0 && read.stdout !== "" ? read.stdout : null;
          }).pipe(Effect.catch(() => Effect.succeed(null)));
        }
        if (native === null) {
          const project = yield* projects
            .byId(session.projectId)
            .pipe(Effect.catch(() => Effect.succeed(null)));
          if (project !== null) {
            const stateDir = sessionStatePathOf(project.storePath, session.id);
            native = yield* Effect.promise(async () => {
              try {
                return await fs.readFile(path.join(stateDir, "transcript.native"), "utf8");
              } catch {
                return null;
              }
            });
          }
        }
        if (native === null) return { sourceHarness: session.harness, events: [] };
        const canonical = ingestNativeSession(session.harness, native, "/workspace/repo");
        return { sourceHarness: session.harness, events: canonical?.events ?? [] };
      });

      const resumeSession = Effect.fn("SessionEngine.resumeSession")(function* (
        sessionId: SessionId,
        harness: string | null,
      ) {
        const session = yield* sessions.byId(sessionId);
        if (session.settledAt === null && ACTIVE_STATUSES.has(session.status)) {
          return yield* new SealantPlatformError({
            code: "session_active",
            status: null,
            message: "The session is already live — attach to it instead of resuming.",
            cause: null,
          });
        }
        const target = harness ?? session.harness;
        const defaultArgv = HARNESS_ARGV[target];
        if (defaultArgv === undefined) {
          return yield* new SealantPlatformError({
            code: "unknown_harness",
            status: null,
            message: `Unknown harness "${target}" — resumable harnesses: ${Object.keys(HARNESS_ARGV).join(", ")}.`,
            cause: null,
          });
        }

        const project = yield* projects.byId(session.projectId);
        const stateDir = sessionStatePathOf(project.storePath, session.id);
        const manifest = yield* readHarnessStateManifest(stateDir, session.id);
        let argv = defaultArgv;
        let nativeImport: ConvertedNativeSession | null = null;
        if (
          manifest.harness === target &&
          (target === "claude" || target === "codex") &&
          manifest.providerSessionId === null
        ) {
          return yield* new HarnessStateInvalidError({
            sessionId,
            path: path.join(stateDir, "manifest.json"),
            message: `Saved ${target} state has no native session id; refusing to start session ${sessionId} from scratch.`,
            cause: new Error("providerSessionId is null"),
          });
        }
        if (manifest.harness !== target) {
          const transcriptPath = path.join(stateDir, "transcript.native");
          const native = yield* Effect.tryPromise({
            try: () => fs.readFile(transcriptPath, "utf8"),
            catch: (cause) =>
              new HarnessStateIOError({
                sessionId,
                operation: "read-transcript",
                path: transcriptPath,
                message: `Could not read the saved ${manifest.harness} transcript for session ${sessionId}.`,
                cause,
              }),
          });
          if (native === "") {
            return yield* new HarnessStateInvalidError({
              sessionId,
              path: transcriptPath,
              message: `The saved ${manifest.harness} transcript for session ${sessionId} is empty.`,
              cause: new Error("transcript.native is empty"),
            });
          }
          // TRUE cross-harness open: convert the saved native session into
          // the TARGET harness's own format and resume it natively — full
          // history, as if the target had run it. Distilled-prompt handoff
          // remains only for pairs conversion cannot express.
          nativeImport = convertNativeSession(manifest.harness, target, native, {
            cwd: "/workspace/repo",
            now: new Date().toISOString(),
          });
          if (nativeImport !== null) {
            argv = nativeImport.resumeArgv;
            yield* sessions.setProviderSessionId(sessionId, nativeImport.providerSessionId);
          } else {
            const turns = extractTranscript(manifest.harness, native);
            if (turns.length === 0) {
              return yield* new HarnessStateInvalidError({
                sessionId,
                path: transcriptPath,
                message: `The saved ${manifest.harness} transcript cannot be opened with ${target}; refusing to start session ${sessionId} from scratch.`,
                cause: new Error("no convertible transcript turns"),
              });
            }
            const openingArgv = promptArgv(target, distillOpeningPrompt(manifest.harness, turns));
            if (openingArgv === null) {
              return yield* new HarnessStateInvalidError({
                sessionId,
                path: transcriptPath,
                message: `${target} cannot import the saved ${manifest.harness} conversation; refusing to start session ${sessionId} from scratch.`,
                cause: new Error("target harness has no opening-prompt adapter"),
              });
            }
            argv = openingArgv;
          }
        }
        if (target !== session.harness) yield* sessions.setHarness(sessionId, target);
        yield* sessions.reopen(sessionId);
        return yield* launchInternal(sessionId, argv, nativeImport, manifest);
      });

      const stop = Effect.fn("SessionEngine.stop")(function* (sessionId: SessionId) {
        const session = yield* sessions.byId(sessionId);
        const activeRun = yield* sessionRuns.activeForSession(sessionId);
        if (activeRun !== null) {
          yield* sessionRuns.settle(activeRun.sealantRunId, "stopped", null);
        }
        yield* sessions.settle(sessionId, "stopped", null);
        yield* tryCheckpoint(session, "user-mark", {
          sealantRunId: activeRun?.sealantRunId ?? null,
          sequence: activeRun?.lastSeenSequence ?? 0n,
        });
        yield* refreshChangeHead(session).pipe(Effect.ignore);
        // The workspace outlives the PTY just long enough to harvest, then
        // dies; forked so a stop request answers immediately. If this process
        // dies first, the next boot's leftover sweep finishes the job.
        yield* Effect.forkIn(sweepWorkspace(sessionId), scope);
      });

      /** Re-attach to sessions that were live when the last process died. */
      const resume = Effect.fn("SessionEngine.resume")(function* () {
        const activeRuns = yield* sessionRuns.listActive();
        const reattached = new Set<string>();
        for (const sessionRun of activeRuns) {
          const session = yield* sessions
            .byId(sessionRun.sessionId)
            .pipe(Effect.catchTag("SessionNotFoundError", () => Effect.succeed(null)));
          if (session === null || session.settledAt !== null) continue;
          reattached.add(session.id);
          yield* forkSupervision(session.id, sessionRun.sealantRunId);
          yield* Effect.logInfo("session engine: re-attached").pipe(
            Effect.annotateLogs({
              sessionId: session.id,
              sealantRunId: sessionRun.sealantRunId,
              from: String(sessionRun.lastSeenSequence),
            }),
          );
        }

        const unsettled = yield* sessions.listUnsettled();
        for (const session of unsettled) {
          if (reattached.has(session.id)) continue;
          yield* sessions.settle(
            session.id,
            "failed",
            "process restarted before the harness started",
          );
        }
      });

      /**
       * Settle-time sweeps are forked fibers; a process restart kills them and
       * the workspace outlives its session. Every boot finishes the job for
       * recently settled sessions whose workspace is still alive — a late
       * harvest rescues any transcript the dead fiber missed, then the reap
       * lands. The platform TTL remains the belt for anything older.
       */
      const sweepLeftovers = Effect.fn("SessionEngine.sweepLeftovers")(function* () {
        const settled = yield* sessions.listRecentlySettled();
        for (const session of settled) {
          if (session.sealantWorkspaceId === null) continue;
          const workspaceId = session.sealantWorkspaceId;
          const sweepIfAlive = Effect.gen(function* () {
            const workspace = yield* sealant.getWorkspace(workspaceId);
            const status = yield* Effect.promise(() => workspace.status());
            if (status !== "queued" && status !== "running" && status !== "ready") return;
            yield* Effect.logInfo("session engine: reaping leftover workspace").pipe(
              Effect.annotateLogs({ sessionId: session.id, workspaceId }),
            );
            yield* sweepWorkspace(session.id);
          }).pipe(
            Effect.catch(() => Effect.void),
            Effect.catchDefect(() => Effect.void),
          );
          yield* Effect.forkIn(sweepIfAlive, scope);
        }
      });

      yield* resume();
      yield* Effect.forkIn(sweepLeftovers(), scope);

      const launch = (sessionId: SessionId, argv: ReadonlyArray<string>) =>
        launchInternal(sessionId, argv, null);

      return { provision, attachRun, launch, checkpointNow, stop, resumeSession, transcript };
    }),
  );
}

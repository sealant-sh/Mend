import type {
  CreateOptions,
  InferenceContinueOptions,
  InferenceRespondOptions,
  InferenceResponse,
  InteractiveSession,
  Run,
  RunFileChange,
  RunOptions,
  TimelineEntry,
  Workspace,
  WorkspaceExecOptions,
  WorkspaceExecResult,
} from "@sealant/sdk";
import { Sealant, SealantApiError, SealantError } from "@sealant/sdk";
import type { Harness } from "@sealant/sdk";
import {
  createRunOp,
  inferenceRespondOp,
  listWorkspacesOp,
  resolveInternalConfig,
  sealantApiClientLayer,
} from "@sealant/sdk/effect";
import { Clock, Effect, Layer, Option, Redacted, Stream } from "effect";
import * as Context from "effect/Context";

import { SealantEnv } from "./config.ts";
import { SealantConnection } from "./connection.ts";
import { SealantPlatformError } from "./errors.ts";

/**
 * The Sealant platform behind an Effect service contract, on SDK 0.5.0.
 *
 * Two publics surfaces back this layer, deliberately split:
 * - Flat request/response calls (connection check, inference, exec-by-id) run
 *   on the `@sealant/sdk/effect` core — typed contract errors, no Promise hop.
 * - The stateful object model (workspace handles, harness start, record
 *   streams / commands / transcript, `run.wait`) stays on the facade: its
 *   composition logic is not exported through `/effect` yet, and duplicating
 *   it here would be exactly the workaround PLATFORM-FEEDBACK.md forbids
 *   (see the 0.5.0 entry, "composition layer not exported").
 */
export class SealantClient extends Context.Service<
  SealantClient,
  {
    readonly createWorkspace: (
      options: CreateOptions,
    ) => Effect.Effect<Workspace, SealantPlatformError>;
    readonly getWorkspace: (id: string) => Effect.Effect<Workspace, SealantPlatformError>;
    /** Runs outlive workspaces — records are replayable long after close-out. */
    readonly getRun: (runId: string) => Effect.Effect<Run, SealantPlatformError>;
    /** BLOCKING: resolves once the harness terminally completed. */
    readonly runHarness: (
      workspace: Workspace,
      prompt: string,
      options?: RunOptions,
    ) => Effect.Effect<Run, SealantPlatformError>;
    /** NON-BLOCKING: a live handle for streaming via `recordStream`. */
    readonly startHarness: (
      workspace: Workspace,
      prompt: string,
      options?: RunOptions,
    ) => Effect.Effect<Run, SealantPlatformError>;
    /**
     * Starts a harness in a workspace BY ID — for runs on a workspace that
     * outlives the handle that created it (follow-ups, verification passes).
     * Re-fetched facade handles carry no harness (PLATFORM-FEEDBACK.md), so
     * this goes through the /effect ops and hand-assembles the run command.
     */
    readonly startHarnessInWorkspace: (
      workspaceId: string,
      harness: Harness,
      prompt: string,
    ) => Effect.Effect<Run, SealantPlatformError>;
    readonly waitRun: (run: Run) => Effect.Effect<Run, SealantPlatformError>;
    /** Open an interactive PTY session in a workspace (0.7.0) — a durable platform resource. */
    readonly openSession: (
      workspace: Workspace,
      argv: ReadonlyArray<string>,
    ) => Effect.Effect<InteractiveSession, SealantPlatformError>;
    /** Reattach to a PTY session by id — works from any workspace handle. */
    /** Stop the workspace: remove its container, settle it "stopped". */
    readonly stopWorkspace: (workspace: Workspace) => Effect.Effect<void, SealantPlatformError>;
    readonly getSession: (
      workspace: Workspace,
      sessionId: string,
    ) => Effect.Effect<InteractiveSession, SealantPlatformError>;
    /**
     * Deterministic check run (0.5.0): commands executed verbatim, recorded
     * into a run record like any process. The exit code is a check datum, not
     * an error — the effect fails only when execution machinery broke.
     */
    readonly exec: (
      workspace: Workspace,
      argv: readonly string[],
      options?: WorkspaceExecOptions,
    ) => Effect.Effect<WorkspaceExecResult, SealantPlatformError>;
    /**
     * The committed diff between two shas, read from git in the workspace — the
     * source of truth for what a change contains. Mend prefers this to the
     * recording-derived `runChanges` diff, which today comes up empty because
     * the runtime is not recording file-change events (PLATFORM-FEEDBACK.md).
     */
    readonly diffCommits: (
      workspaceId: string,
      base: string,
      head: string,
    ) => Effect.Effect<
      {
        readonly diff: string;
        readonly files: ReadonlyArray<{
          readonly path: string;
          readonly additions: number;
          readonly deletions: number;
        }>;
      },
      SealantPlatformError
    >;
    /**
     * Inference on connected accounts (0.5.0): server-side via the official
     * agent SDKs; the tool loop is caller-executed via `sessionId`.
     */
    readonly inferenceRespond: (
      options: InferenceRespondOptions | InferenceContinueOptions,
    ) => Effect.Effect<InferenceResponse, SealantPlatformError>;
    /** The record's live event stream — typed entries, resumable for crash-resume. */
    readonly recordStream: (
      run: Run,
      options?: { readonly from?: bigint },
    ) => Stream.Stream<TimelineEntry, SealantPlatformError>;
    /** The full timeline as recorded so far — ends at the record's end, never waits for more. */
    readonly recordTimeline: (
      run: Run,
      options?: { readonly from?: bigint },
    ) => Stream.Stream<TimelineEntry, SealantPlatformError>;
    /** The before/after of what a run changed: file list plus the unified diff. */
    readonly runChanges: (run: Run) => Effect.Effect<
      {
        readonly files: ReadonlyArray<RunFileChange>;
        readonly diff: string;
      },
      SealantPlatformError
    >;
    /** Cheap authenticated round-trip for the settings page. Never fails — the failure is the content. */
    readonly connectionCheck: () => Effect.Effect<SealantConnection>;
  }
>()("@mend/sealant/SealantClient") {
  static readonly layer = Layer.effect(
    SealantClient,
    Effect.gen(function* () {
      const env = yield* SealantEnv;
      const publicConfig = {
        baseUrl: env.baseUrl,
        ...Option.match(env.apiKey, {
          onNone: () => ({}),
          onSome: (key) => ({ apiKey: Redacted.value(key) }),
        }),
      };

      // The facade, for the stateful object model.
      const sealant = yield* Effect.acquireRelease(
        Effect.sync(() => new Sealant(publicConfig)),
        (client) => Effect.promise(() => client.close()),
      );

      // The Effect core, for flat operations — built once, provided per call.
      const internalConfig = resolveInternalConfig(publicConfig);
      const apiContext = yield* Layer.build(sealantApiClientLayer(internalConfig));
      const ownerUserId = internalConfig.hostLocal.ownerUserId;

      const createWorkspace = Effect.fn("SealantClient.createWorkspace")((options: CreateOptions) =>
        wrap(() => sealant.workspaces.create(options)),
      );

      const getWorkspace = Effect.fn("SealantClient.getWorkspace")((id: string) =>
        wrap(() => sealant.workspaces.get(id)),
      );

      const getRun = Effect.fn("SealantClient.getRun")((runId: string) =>
        wrap(() => sealant.runs.get(runId)),
      );

      const runHarness = Effect.fn("SealantClient.runHarness")(
        (workspace: Workspace, prompt: string, options?: RunOptions) =>
          wrap(() => workspace.harness.run(prompt, options)),
      );

      const startHarness = Effect.fn("SealantClient.startHarness")(
        (workspace: Workspace, prompt: string, options?: RunOptions) =>
          wrap(() => workspace.harness.start(prompt, options)),
      );

      const waitRun = Effect.fn("SealantClient.waitRun")((run: Run) => wrap(() => run.wait()));

      const openSession = Effect.fn("SealantClient.openSession")(
        (workspace: Workspace, argv: ReadonlyArray<string>) =>
          wrap(() => workspace.sessions.open(argv)),
      );

      const stopWorkspace = Effect.fn("SealantClient.stopWorkspace")((workspace: Workspace) =>
        wrap(() => workspace.stop()),
      );

      const getSession = Effect.fn("SealantClient.getSession")(
        (workspace: Workspace, sessionId: string) => wrap(() => workspace.sessions.get(sessionId)),
      );

      // No idempotency on this path: `attemptId` is a workspace-attempt FK,
      // not a client key, and the wire op carries no idempotency header —
      // callers dedupe upstream (Mend routes each comment exactly once).
      const startHarnessInWorkspace = Effect.fn("SealantClient.startHarnessInWorkspace")(function* (
        workspaceId: string,
        harness: Harness,
        prompt: string,
      ) {
        const wire = yield* createRunOp({
          workspaceId,
          harnessId: harness.id,
          ownerUserId,
          mode: "one-shot",
          prompt,
          command: harness.buildRunCommand(prompt),
        }).pipe(Effect.provideContext(apiContext), Effect.mapError(toPlatformError));
        // The facade's run handle carries the record surface and wait().
        return yield* wrap(() => sealant.runs.get(wire.runId));
      });

      const exec = Effect.fn("SealantClient.exec")(
        (workspace: Workspace, argv: readonly string[], options?: WorkspaceExecOptions) =>
          wrap(() => workspace.exec(argv, options)),
      );

      const diffCommits = Effect.fn("SealantClient.diffCommits")(function* (
        workspaceId: string,
        base: string,
        head: string,
      ) {
        const workspace = yield* wrap(() => sealant.workspaces.get(workspaceId));
        const range = `${base}..${head}`;
        const unified = yield* wrap(() => workspace.exec(["git", "diff", range]));
        // `--numstat` gives exact per-file counts (tab-separated: adds, dels, path).
        const numstat = yield* wrap(() => workspace.exec(["git", "diff", "--numstat", range]));
        const files = numstat.stdout
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line !== "")
          .map((line) => {
            const [adds, dels, ...rest] = line.split("\t");
            return {
              path: rest.join("\t"),
              additions: Number(adds) || 0,
              deletions: Number(dels) || 0,
            };
          })
          .filter((file) => file.path !== "");
        return { diff: unified.stdout, files };
      });

      const inferenceRespond = Effect.fn("SealantClient.inferenceRespond")(
        (options: InferenceRespondOptions | InferenceContinueOptions) =>
          "sessionId" in options
            ? inferenceRespondOp({
                ownerUserId,
                sessionId: options.sessionId,
                toolResults: options.toolResults,
              }).pipe(
                Effect.provideContext(apiContext),
                Effect.mapError(toPlatformError),
                Effect.map(toInferenceResponse),
              )
            : inferenceRespondOp({
                ownerUserId,
                prompt: options.prompt,
                system: options.system,
                model: options.model,
                maxTurns: options.maxTurns,
                tools: options.tools?.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  inputSchema: tool.inputSchema,
                })),
                responseFormat: options.responseFormat,
                credentials: {
                  profileId: options.credentials.profile,
                  claude: accountReference(options.credentials.claude),
                  codex: accountReference(options.credentials.codex),
                },
              }).pipe(
                Effect.provideContext(apiContext),
                Effect.mapError(toPlatformError),
                Effect.map(toInferenceResponse),
              ),
      );

      const recordStream = (run: Run, options?: { readonly from?: bigint }) =>
        Stream.fromAsyncIterable(
          run.record.stream(options?.from === undefined ? {} : { from: options.from }),
          toPlatformError,
        );

      const recordTimeline = (run: Run, options?: { readonly from?: bigint }) =>
        Stream.fromAsyncIterable(
          run.record.timeline(options?.from === undefined ? {} : { from: options.from }),
          toPlatformError,
        );

      const runChanges = Effect.fn("SealantClient.runChanges")((run: Run) =>
        wrap(async () => ({ files: run.changes.files, diff: await run.changes.diff() })),
      );

      const connectionCheck = Effect.fn("SealantClient.connectionCheck")(function* () {
        const now = yield* Clock.currentTimeMillis;
        return yield* listWorkspacesOp({ ownerUserId, limit: "1" }).pipe(
          Effect.provideContext(apiContext),
          Effect.map(
            () =>
              new SealantConnection({
                status: "connected",
                baseUrl: env.baseUrl,
                detail: null,
                checkedAt: new Date(now),
              }),
          ),
          Effect.catch((error) =>
            Effect.succeed(
              new SealantConnection({
                status: connectionStatusOf(error),
                baseUrl: env.baseUrl,
                detail: toPlatformError(error).message,
                checkedAt: new Date(now),
              }),
            ),
          ),
        );
      });

      return {
        createWorkspace,
        getWorkspace,
        getRun,
        runHarness,
        startHarness,
        startHarnessInWorkspace,
        waitRun,
        openSession,
        stopWorkspace,
        getSession,
        exec,
        diffCommits,
        inferenceRespond,
        recordStream,
        recordTimeline,
        runChanges,
        connectionCheck,
      };
    }),
  );

  /** `layer` with its environment attached — the composition-root convenience. */
  static readonly layerFromEnv = SealantClient.layer.pipe(Layer.provide(SealantEnv.layer));
}

/** The facade's `true` means "the account named default"; the wire wants a name or nothing. */
const accountReference = (value: boolean | string | undefined) =>
  typeof value === "string" ? value : value === true ? "default" : undefined;

/** The wire's optional `usage` needs re-narrowing under exactOptionalPropertyTypes. */
const toInferenceResponse = (wire: {
  readonly sessionId: string;
  readonly turn: InferenceResponse["turn"];
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number } | undefined;
}): InferenceResponse => ({
  sessionId: wire.sessionId,
  turn: wire.turn,
  ...(wire.usage === undefined ? {} : { usage: wire.usage }),
});

/** The tag of a typed contract error, when the value carries one. */
const tagOf = (value: unknown): string | null => {
  if (typeof value === "object" && value !== null && "_tag" in value) {
    const tag: unknown = value["_tag"];
    return typeof tag === "string" ? tag : null;
  }
  return null;
};

const toPlatformError = (cause: unknown) =>
  new SealantPlatformError({
    code: cause instanceof SealantError ? cause.code : (tagOf(cause) ?? "UNKNOWN"),
    status: cause instanceof SealantApiError ? (cause.status ?? null) : null,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });

/**
 * Maps a typed contract failure onto what the settings page reports. A typed
 * error means the control plane answered; only a transport-level failure is
 * "unreachable".
 */
const connectionStatusOf = (error: unknown) => {
  switch (tagOf(error)) {
    case "WorkspaceUnauthorizedError":
    case "WorkspaceForbiddenError":
      return "unauthorized" as const;
    case "HttpClientError":
      return "unreachable" as const;
    default:
      return "mismatched" as const;
  }
};

const wrap = <A>(run: () => Promise<A>): Effect.Effect<A, SealantPlatformError> =>
  Effect.tryPromise({ try: run, catch: toPlatformError });

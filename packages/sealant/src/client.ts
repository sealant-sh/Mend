import type { CreateOptions, Run, RunOptions, TimelineEntry, Workspace } from "@sealant/sdk";
import { Sealant, SealantApiError, SealantError } from "@sealant/sdk";
import { Clock, Effect, Layer, Option, Redacted, Stream } from "effect";
import * as Context from "effect/Context";

import { SealantEnv } from "./config.ts";
import { SealantConnection } from "./connection.ts";
import { SealantPlatformError } from "./errors.ts";

const toPlatformError = (cause: unknown) =>
  new SealantPlatformError({
    code: cause instanceof SealantError ? cause.code : "UNKNOWN",
    status: cause instanceof SealantApiError ? (cause.status ?? null) : null,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });

const wrap = <A>(run: () => Promise<A>): Effect.Effect<A, SealantPlatformError> =>
  Effect.tryPromise({ try: run, catch: toPlatformError });

const recordStream = (run: Run, options?: { readonly from?: bigint }) =>
  Stream.fromAsyncIterable(
    run.record.stream(options?.from === undefined ? {} : { from: options.from }),
    toPlatformError,
  );

/**
 * The Sealant platform behind an Effect service contract. Wraps the public
 * SDK's Promise facade — and nothing else. When `@sealant/sdk/effect` ships
 * (PLATFORM-FEEDBACK.md, "subpath not exported") this live layer collapses to
 * the SDK's own Effect core; the contract stays put.
 *
 * Handles returned here (`Workspace`, `Run`) are the SDK's public interfaces,
 * passed through deliberately: they are the published contract, not internals.
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
    readonly waitRun: (run: Run) => Effect.Effect<Run, SealantPlatformError>;
    /** The record's live event stream, resumable from a sequence for crash-resume. */
    readonly recordStream: (
      run: Run,
      options?: { readonly from?: bigint },
    ) => Stream.Stream<TimelineEntry, SealantPlatformError>;
    /** Cheap authenticated round-trip for the settings page. Never fails — the failure is the content. */
    readonly connectionCheck: () => Effect.Effect<SealantConnection>;
  }
>()("@mend/sealant/SealantClient") {
  static readonly layer = Layer.effect(
    SealantClient,
    Effect.gen(function* () {
      const env = yield* SealantEnv;
      const sealant = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new Sealant({
              baseUrl: env.baseUrl,
              ...Option.match(env.apiKey, {
                onNone: () => ({}),
                onSome: (key) => ({ apiKey: Redacted.value(key) }),
              }),
            }),
        ),
        (client) => Effect.promise(() => client.close()),
      );

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

      const connectionCheck = Effect.fn("SealantClient.connectionCheck")(function* () {
        const now = yield* Clock.currentTimeMillis;
        return yield* wrap(() => sealant.workspaces.list({ limit: 1 })).pipe(
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
                status:
                  error.status === 401 || error.status === 403 ? "unauthorized" : "unreachable",
                baseUrl: env.baseUrl,
                detail: error.message,
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
        waitRun,
        recordStream,
        connectionCheck,
      };
    }),
  );

  /** `layer` with its environment attached — the composition-root convenience. */
  static readonly layerFromEnv = SealantClient.layer.pipe(Layer.provide(SealantEnv.layer));
}

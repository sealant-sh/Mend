import { Auth } from "@mend/auth";
import { IssuesRepo, RunsRepo } from "@mend/db";
import { SealantClient } from "@mend/sealant";
import { Config, Effect, Layer, Option } from "effect";
import { HttpServerRequest } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import {
  AuthMiddleware,
  CurrentUser,
  HealthStatus,
  MendApi,
  NotFound,
  RunCommandView,
  RunDetail,
  Unauthorized,
} from "./contract.ts";

/** Resolves the better-auth session (cookie or bearer) and provides CurrentUser. */
export const AuthMiddlewareLive = Layer.effect(AuthMiddleware)(
  Effect.gen(function* () {
    const auth = yield* Auth;
    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const headers = new Headers(Object.entries(request.headers));
        const session = yield* auth.getSession(headers);
        if (Option.isNone(session)) return yield* Effect.fail(new Unauthorized());
        return yield* httpEffect.pipe(Effect.provideService(CurrentUser, session.value));
      });
  }),
);

export const HealthGroupLive = HttpApiBuilder.group(MendApi, "health", (handlers) =>
  handlers.handle("status", () =>
    Effect.gen(function* () {
      const version = yield* Config.string("MEND_VERSION").pipe(
        Config.orElse(() => Config.succeed("dev")),
        Effect.orDie,
      );
      return new HealthStatus({ status: "ok", version });
    }),
  ),
);

export const SealantGroupLive = HttpApiBuilder.group(MendApi, "sealant", (handlers) =>
  handlers.handle("connection", () =>
    Effect.gen(function* () {
      const sealant = yield* SealantClient;
      return yield* sealant.connectionCheck();
    }),
  ),
);

export const IssuesGroupLive = HttpApiBuilder.group(MendApi, "issues", (handlers) =>
  handlers
    .handle("list", () =>
      Effect.gen(function* () {
        const issues = yield* IssuesRepo;
        return yield* issues.list();
      }),
    )
    .handle("create", ({ payload }) =>
      Effect.gen(function* () {
        const issues = yield* IssuesRepo;
        return yield* issues.create(payload);
      }),
    )
    .handle("detail", ({ params }) =>
      Effect.gen(function* () {
        const issues = yield* IssuesRepo;
        const runs = yield* RunsRepo;
        const issue = yield* issues
          .byId(params.id)
          .pipe(Effect.mapError(() => new NotFound({ id: params.id })));
        const issueRuns = yield* runs.listForIssue(params.id);
        return { issue, runs: issueRuns };
      }),
    )
    .handle("move", ({ params, payload }) =>
      Effect.gen(function* () {
        const issues = yield* IssuesRepo;
        return yield* issues
          .move(params.id, payload)
          .pipe(Effect.mapError(() => new NotFound({ id: params.id })));
      }),
    ),
);

export const RunsGroupLive = HttpApiBuilder.group(MendApi, "runs", (handlers) =>
  handlers.handle("detail", ({ params }) =>
    Effect.gen(function* () {
      const runs = yield* RunsRepo;
      const sealant = yield* SealantClient;
      const run = yield* runs
        .byId(params.id)
        .pipe(Effect.mapError(() => new NotFound({ id: params.id })));

      if (run.sealantRunId === null) {
        return new RunDetail({ run, commands: [], transcript: null, recordError: null });
      }

      // The SDK read surface backs the view; a read failure is shown, not hidden.
      const record = yield* sealant.getRun(run.sealantRunId).pipe(
        Effect.flatMap((sdkRun) =>
          Effect.all({
            commands: Effect.tryPromise({
              try: () => sdkRun.record.commands(),
              catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
            }),
            transcript: Effect.tryPromise({
              try: () => sdkRun.record.transcript(),
              catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
            }),
          }),
        ),
        Effect.mapError((error) => (typeof error === "string" ? error : error.message)),
        Effect.map(({ commands, transcript }) => ({
          commands: commands.map(
            (command) =>
              new RunCommandView({
                command: command.command,
                exitCode: command.exitCode ?? null,
                durationMs: command.durationMs ?? null,
              }),
          ),
          transcript,
          recordError: null as string | null,
        })),
        Effect.catch((message) =>
          Effect.succeed({
            commands: [] as ReadonlyArray<RunCommandView>,
            transcript: null as string | null,
            recordError: message,
          }),
        ),
      );

      return new RunDetail({ run, ...record });
    }),
  ),
);

/** Every group implementation plus the API registration, ready for the boundary. */
export const MendApiLive = HttpApiBuilder.layer(MendApi).pipe(
  Layer.provide(HealthGroupLive),
  Layer.provide(SealantGroupLive),
  Layer.provide(IssuesGroupLive),
  Layer.provide(RunsGroupLive),
  Layer.provide(AuthMiddlewareLive),
);

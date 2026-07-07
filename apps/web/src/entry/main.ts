import { existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { EventsRoutes, MendApiLive } from "@mend/api";
import { Auth } from "@mend/auth";
import {
  BriefCommentsRepo,
  BriefsRepo,
  ChangesRepo,
  InferenceCallsRepo,
  IssuesRepo,
  MigratorLive,
  PgLive,
  RunsRepo,
  SettingsRepo,
} from "@mend/db";
import {
  BriefCompiler,
  CommentRouter,
  CompileBriefJob,
  FailureSummarizer,
  liveToolsLayer,
  RouteCommentJob,
  sealantProviderLayer,
  SummarizeFailureJob,
} from "@mend/inference";
import { Dispatcher, JobRunner, runStarterLayer, startRunToolLayer } from "@mend/jobs";
import { SealantClient } from "@mend/sealant";
import { Config, Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

/**
 * The composition boundary (ARCHITECTURE.md §2): every service is wired here
 * and nowhere else. One process runs the web app, the API, and the workers;
 * MEND_MODE (`all` default · `web` · `worker`) splits it later without a
 * redesign.
 */

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// ─── Data: Postgres, migrated before anything reads it ─────────────────────
const DatabaseLive = Layer.mergeAll(
  IssuesRepo.layer,
  RunsRepo.layer,
  ChangesRepo.layer,
  BriefsRepo.layer,
  BriefCommentsRepo.layer,
  SettingsRepo.layer,
  InferenceCallsRepo.layer,
).pipe(Layer.provideMerge(MigratorLive.pipe(Layer.provideMerge(PgLive))));

// ─── better-auth mounted under /api/auth ────────────────────────────────────
const AuthRoutes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const auth = yield* Auth;
    yield* router.add("*", "/api/auth/*", (request) =>
      Effect.gen(function* () {
        const webRequest = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
        const response = yield* auth.handler(webRequest);
        return HttpServerResponse.fromWeb(response);
      }),
    );
  }),
);

// ─── The built web app: static assets + SSR (absent in dev — vite serves it) ─
const WebAppRoutes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const clientDir = path.join(appDir, "dist/client");
    const ssrEntry = path.join(appDir, "dist/server/server.js");
    if (!existsSync(ssrEntry)) {
      yield* Effect.logInfo("no built web app found — serving API only (dev mode)");
      return;
    }
    const ssr: { readonly fetch: (request: Request) => Promise<Response> } = yield* Effect.promise(
      async () => {
        const mod: {
          readonly default: { readonly fetch: (request: Request) => Promise<Response> };
        } = await import(pathToFileURL(ssrEntry).href);
        return mod.default;
      },
    );

    yield* router.add("*", "/*", (request) =>
      Effect.gen(function* () {
        if (request.method === "GET" || request.method === "HEAD") {
          const pathname = new URL(request.url, "http://mend.local").pathname;
          const candidate = path.join(clientDir, pathname);
          const insideClientDir = candidate.startsWith(clientDir + path.sep);
          if (insideClientDir && existsSync(candidate) && statSync(candidate).isFile()) {
            return yield* HttpServerResponse.file(candidate).pipe(Effect.orDie);
          }
        }
        const webRequest = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
        const response = yield* Effect.promise(() => ssr.fetch(webRequest));
        return HttpServerResponse.fromWeb(response);
      }),
    );
  }),
);

// ─── HTTP: the API contract + auth + web app on one port ───────────────────
const ServerLive = Layer.unwrap(
  Effect.gen(function* () {
    const port = yield* Config.int("PORT").pipe(Config.orElse(() => Config.succeed(3105)));
    return HttpRouter.serve(
      Layer.mergeAll(MendApiLive, AuthRoutes, EventsRoutes, WebAppRoutes),
    ).pipe(Layer.provide(NodeHttpServer.layer(createServer, { port })));
  }),
);

// ─── Worker: the dispatcher loop and the side-effect jobs it feeds ──────────
const decodeCompileBriefJob = Schema.decodeUnknownEffect(CompileBriefJob);
const decodeSummarizeFailureJob = Schema.decodeUnknownEffect(SummarizeFailureJob);
const decodeRouteCommentJob = Schema.decodeUnknownEffect(RouteCommentJob);

/** The inference job workers: a failed handler dies into the engine's retry. */
const InferenceWorkersLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const jobs = yield* JobRunner;
    const compiler = yield* BriefCompiler;
    const summarizer = yield* FailureSummarizer;
    const router = yield* CommentRouter;
    yield* jobs.work("brief", (payload) =>
      decodeCompileBriefJob(payload).pipe(
        Effect.flatMap((job) => compiler.compile(job)),
        Effect.orDie,
      ),
    );
    yield* jobs.work("failure-brief", (payload) =>
      decodeSummarizeFailureJob(payload).pipe(
        Effect.flatMap((job) => summarizer.summarize(job)),
        Effect.orDie,
      ),
    );
    yield* jobs.work("route-comment", (payload) =>
      decodeRouteCommentJob(payload).pipe(
        Effect.flatMap((job) => router.route(job)),
        Effect.orDie,
      ),
    );
  }),
);

const WorkerLive = Layer.mergeAll(
  Layer.effectDiscard(
    Effect.gen(function* () {
      const dispatcher = yield* Dispatcher;
      yield* Effect.forkScoped(dispatcher.run());
    }),
  ),
  InferenceWorkersLive,
).pipe(
  Layer.provide(Dispatcher.layer),
  Layer.provide(BriefCompiler.layer),
  Layer.provide(FailureSummarizer.layer),
  Layer.provide(CommentRouter.layer),
  Layer.provide(liveToolsLayer),
  // start_run: the one tool that reaches the run machinery.
  Layer.provide(startRunToolLayer),
  // Inference runs on the user's Sealant-connected subscriptions — Mend ships no model keys.
  Layer.provide(sealantProviderLayer),
  Layer.provide(runStarterLayer),
);

const MainLive = Layer.unwrap(
  Effect.gen(function* () {
    const mode = yield* Config.schema(Schema.Literals(["all", "web", "worker"]), "MEND_MODE").pipe(
      Config.orElse(() => Config.succeed("all" as const)),
    );
    yield* Effect.logInfo("mend starting").pipe(Effect.annotateLogs({ mode }));
    const parts =
      mode === "web"
        ? ServerLive
        : mode === "worker"
          ? WorkerLive
          : Layer.merge(ServerLive, WorkerLive);
    return parts.pipe(
      // Shared by the API (enqueue on comment) and the workers (one instance).
      Layer.provide(JobRunner.pgBossLayer),
      Layer.provide(Auth.layer),
      Layer.provide(SealantClient.layerFromEnv),
      Layer.provide(DatabaseLive),
    );
  }),
);

NodeRuntime.runMain(Layer.launch(MainLive));

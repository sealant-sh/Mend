import { Auth } from "@mend/auth";
import { IssuesRepo } from "@mend/db";
import { SealantClient } from "@mend/sealant";
import { Config, Effect, Layer, Option } from "effect";
import { HttpServerRequest } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { AuthMiddleware, CurrentUser, HealthStatus, MendApi, Unauthorized } from "./contract.ts";

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
    ),
);

/** Every group implementation plus the API registration, ready for the boundary. */
export const MendApiLive = HttpApiBuilder.layer(MendApi).pipe(
  Layer.provide(HealthGroupLive),
  Layer.provide(SealantGroupLive),
  Layer.provide(IssuesGroupLive),
  Layer.provide(AuthMiddlewareLive),
);

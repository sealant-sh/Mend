import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { Config, Effect, Layer, Option, Redacted } from "effect";
import * as Context from "effect/Context";
import pg from "pg";

/** What the rest of the product needs to know about who is signed in. */
export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

export interface AuthSession {
  readonly user: AuthUser;
  readonly expiresAt: Date;
}

/**
 * better-auth mounted behind an Effect contract: cookie sessions for the web
 * app, bearer tokens (via the bearer plugin) for mobile and CLI-ish use later.
 * The server entry routes `/api/auth/*` to `handler`.
 */
export class Auth extends Context.Service<
  Auth,
  {
    readonly handler: (request: Request) => Effect.Effect<Response>;
    readonly getSession: (headers: Headers) => Effect.Effect<Option.Option<AuthSession>>;
  }
>()("@mend/auth/Auth") {
  static readonly layer = Layer.effect(
    Auth,
    Effect.gen(function* () {
      const databaseUrl = yield* Config.redacted("DATABASE_URL").pipe(
        Config.orElse(() =>
          Config.succeed(Redacted.make("postgres://mend:mend@localhost:5433/mend")),
        ),
      );
      const secret = yield* Config.redacted("BETTER_AUTH_SECRET").pipe(
        Config.orElse(() => Config.succeed(Redacted.make("mend-dev-secret-do-not-deploy"))),
      );
      const baseUrl = yield* Config.string("APP_URL").pipe(
        Config.orElse(() => Config.succeed("http://localhost:3101")),
      );

      const pool = yield* Effect.acquireRelease(
        Effect.sync(() => new pg.Pool({ connectionString: Redacted.value(databaseUrl) })),
        (p) => Effect.promise(() => p.end()),
      );

      // Sign-up stays open: a self-hosted instance sits behind the operator's
      // perimeter (ARCHITECTURE.md §9). Revisit at the M3 self-host alpha.
      const auth = betterAuth({
        database: pool,
        secret: Redacted.value(secret),
        baseURL: baseUrl,
        basePath: "/api/auth",
        emailAndPassword: { enabled: true },
        plugins: [bearer()],
        trustedOrigins: [baseUrl],
      });

      const handler = Effect.fn("Auth.handler")((request: Request) =>
        Effect.promise(() => auth.handler(request)),
      );

      const getSession = Effect.fn("Auth.getSession")(function* (headers: Headers) {
        const result = yield* Effect.promise(() => auth.api.getSession({ headers }));
        if (result === null) return Option.none<AuthSession>();
        return Option.some<AuthSession>({
          user: {
            id: result.user.id,
            email: result.user.email,
            name: result.user.name,
          },
          expiresAt: result.session.expiresAt,
        });
      });

      return { handler, getSession };
    }),
  );
}

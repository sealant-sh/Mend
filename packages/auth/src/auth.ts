import { createHash } from "node:crypto";

import { NetworkConfig, type PublicNetwork } from "@mend/network";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { bearer } from "better-auth/plugins";
import { Config, Effect, Layer, Option, Redacted, Schema } from "effect";
import * as Context from "effect/Context";
import { Pool } from "pg";

/** What the rest of the product needs to know about who is signed in. */
export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

/** A signed-in user's session as the rest of Mend consumes it. */
export interface AuthSession {
  readonly user: AuthUser;
  readonly expiresAt: Date;
}

/** Inputs for constructing the Better Auth request handler. */
export interface AuthHandlerOptions {
  /** The only browser origins Better Auth accepts. */
  readonly network: PublicNetwork;
  /** Better Auth's signing secret. */
  readonly secret: string;
  /** The production database, omitted to use Better Auth's in-memory adapter. */
  readonly database?: BetterAuthOptions["database"];
}

const createBetterAuth = (options: AuthHandlerOptions) =>
  betterAuth({
    ...(options.database === undefined ? {} : { database: options.database }),
    secret: options.secret,
    baseURL: options.network.appUrl,
    basePath: "/api/auth",
    emailAndPassword: { enabled: true },
    advanced: { disableOriginCheck: false },
    plugins: [bearer()],
    trustedOrigins: [...options.network.allowedOrigins],
  });

/** Construct the real Better Auth handler with Mend's fixed origin policy. */
export const createAuthHandler = (
  options: AuthHandlerOptions,
): ((request: Request) => Promise<Response>) => createBetterAuth(options).handler;

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
>()("@mend/auth/Auth") {}

/** Postgres-backed Better Auth and paired-device authentication. */
export const AuthLive: Layer.Layer<Auth, Config.ConfigError, NetworkConfig> = Layer.effect(
  Auth,
  Effect.gen(function* () {
    const databaseUrl = yield* Config.redacted("DATABASE_URL").pipe(
      Config.orElse(() =>
        Config.succeed(Redacted.make("postgres://mend:mend@localhost:5434/mend")),
      ),
    );
    const secret = yield* Config.redacted("BETTER_AUTH_SECRET").pipe(
      Config.orElse(() => Config.succeed(Redacted.make("mend-dev-secret-do-not-deploy"))),
    );
    // Better Auth otherwise reads this ambient variable in addition to its
    // options, which would create a second, unvalidated origin allowlist.
    yield* Config.schema(Schema.Literal(""), "BETTER_AUTH_TRUSTED_ORIGINS").pipe(
      Config.withDefault(""),
    );
    const network = yield* NetworkConfig;

    const pool = yield* Effect.acquireRelease(
      Effect.sync(() => new Pool({ connectionString: Redacted.value(databaseUrl) })),
      (p) => Effect.promise(() => p.end()),
    );

    // Sign-up stays open: a self-hosted instance sits behind the operator's
    // perimeter (ARCHITECTURE.md §9). Revisit at the M3 self-host alpha.
    const auth = createBetterAuth({
      database: pool,
      secret: Redacted.value(secret),
      network,
    });

    const handler = Effect.fn("Auth.handler")((request: Request) =>
      Effect.promise(() => auth.handler(request)),
    );

    // A fixed operator token for dev/device testing: MEND_STATIC_TOKEN=xyz
    // makes `Bearer xyz` authenticate as the FIRST user. Opt-in via env,
    // never set in anything deployed.
    const staticToken = yield* Config.string("MEND_STATIC_TOKEN").pipe(
      Config.orElse(() => Config.succeed("")),
    );

    // A paired device authenticates with its own bearer token (mdt_…): only the
    // sha256 is stored, so the check is a hash and a lookup. `last_used_at` is
    // a fact about the device, not a session clock — one write a minute is enough.
    const DEVICE_LAST_USED_INTERVAL_MS = 60_000;

    const deviceSession = Effect.fn("Auth.deviceSession")(function* (headers: Headers) {
      const authorization = headers.get("authorization");
      if (authorization === null || !authorization.startsWith("Bearer ")) {
        return Option.none<AuthSession>();
      }
      const token = authorization.slice("Bearer ".length).trim();
      if (token === "") return Option.none<AuthSession>();
      const tokenHash = createHash("sha256").update(token).digest("hex");

      const rows = yield* Effect.promise(() =>
        pool.query(
          `SELECT d.id AS device_id, d.last_used_at, u.id AS user_id, u.email, u.name
               FROM device_tokens d
               JOIN "user" u ON u.id = d.user_id
              WHERE d.token_hash = $1 AND d.revoked_at IS NULL
              LIMIT 1`,
          [tokenHash],
        ),
      );
      const row = rows.rows[0] as
        | {
            readonly device_id: string;
            readonly last_used_at: Date | null;
            readonly user_id: string;
            readonly email: string;
            readonly name: string;
          }
        | undefined;
      if (row === undefined) return Option.none<AuthSession>();

      const stale =
        row.last_used_at === null ||
        Date.now() - row.last_used_at.getTime() >= DEVICE_LAST_USED_INTERVAL_MS;
      if (stale) {
        yield* Effect.promise(() =>
          pool.query("UPDATE device_tokens SET last_used_at = now() WHERE id = $1", [
            row.device_id,
          ]),
        );
      }

      return Option.some<AuthSession>({
        user: { id: row.user_id, email: row.email, name: row.name },
        expiresAt: new Date(Date.now() + 86_400_000),
      });
    });

    const getSession = Effect.fn("Auth.getSession")(function* (headers: Headers) {
      if (staticToken !== "" && headers.get("authorization") === `Bearer ${staticToken}`) {
        const rows = yield* Effect.promise(() =>
          pool.query('SELECT id, email, name FROM "user" ORDER BY "createdAt" ASC LIMIT 1'),
        );
        const row = rows.rows[0] as
          | { readonly id: string; readonly email: string; readonly name: string }
          | undefined;
        if (row !== undefined) {
          return Option.some<AuthSession>({
            user: { id: row.id, email: row.email, name: row.name },
            expiresAt: new Date(Date.now() + 86_400_000),
          });
        }
      }
      const result = yield* Effect.promise(() => auth.api.getSession({ headers }));
      // Not a better-auth session: it may still be a paired device's token.
      if (result === null) return yield* deviceSession(headers);
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

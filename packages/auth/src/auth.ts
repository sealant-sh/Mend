import { createHash } from "node:crypto";
import { networkInterfaces } from "node:os";

import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { Config, Effect, Layer, Option, Redacted } from "effect";
import * as Context from "effect/Context";
import { Pool } from "pg";

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
 * Where browsers arrive in development: vite serves the web app on 3105 and
 * proxies /trpc to the dev web server on 3104 (apps/web/scripts/dev.mjs).
 */
const DEV_WEB_PORTS = [3105, 3104];

/**
 * Every non-internal IPv4 bound to this machine — the same observation
 * apps/api/src/routes/machine.ts makes for the pairing endpoint, repeated here
 * because the API server depends on this package and cannot be imported back.
 */
const localAddresses = (
  interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces(),
): ReadonlyArray<string> => {
  const found: Array<string> = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) found.push(entry.address);
    }
  }
  return found;
};

/**
 * Which origins better-auth will accept a session from. APP_URL is
 * authoritative; localhost covers every local entry point; and every address
 * this machine actually answers on is added, because a phone on the tailnet or
 * the LAN reaches the web app by IP and would otherwise be refused. Browsers
 * arrive on the web tier's port (`webPort`), not this API process's own
 * (`serverPort`), so both are enumerated alongside the dev entry points. The
 * set is read once at startup — a machine that changes address needs a restart.
 */
export const trustedOrigins = (
  baseUrl: string,
  serverPort: number,
  webPort: number,
  interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces(),
): Array<string> => {
  const ports = [...new Set([serverPort, webPort, ...DEV_WEB_PORTS])];
  const origins = [baseUrl, ...ports.map((port) => `http://localhost:${port}`)];
  for (const address of localAddresses(interfaces)) {
    for (const port of ports) origins.push(`http://${address}:${port}`);
  }
  return [...new Set(origins)];
};

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
          Config.succeed(Redacted.make("postgres://mend:mend@localhost:5434/mend")),
        ),
      );
      const secret = yield* Config.redacted("BETTER_AUTH_SECRET").pipe(
        Config.orElse(() => Config.succeed(Redacted.make("mend-dev-secret-do-not-deploy"))),
      );
      const baseUrl = yield* Config.string("APP_URL").pipe(
        Config.orElse(() => Config.succeed("http://localhost:3101")),
      );
      // The API process's own port (apps/api defaults to 3101) and the web
      // tier's port browsers actually arrive on (scripts/serve.mjs and the
      // helm chart set MEND_WEB_PORT on the API process; 3105 everywhere).
      const serverPort = yield* Config.int("PORT").pipe(Config.orElse(() => Config.succeed(3101)));
      const webPort = yield* Config.int("MEND_WEB_PORT").pipe(
        Config.orElse(() => Config.succeed(3105)),
      );

      const pool = yield* Effect.acquireRelease(
        Effect.sync(() => new Pool({ connectionString: Redacted.value(databaseUrl) })),
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
        trustedOrigins: trustedOrigins(baseUrl, serverPort, webPort),
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
}

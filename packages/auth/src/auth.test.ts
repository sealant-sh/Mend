import { makePublicNetwork, NetworkConfig, PublicOrigin } from "@mend/network";
import { ConfigProvider, Effect, Layer, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { AuthLive, createAuthHandler } from "./auth.ts";

const decodeOrigin = Schema.decodeUnknownSync(PublicOrigin);
const network = makePublicNetwork(decodeOrigin("http://localhost:3105"), [
  decodeOrigin("http://mac-mini.local:3105"),
  decodeOrigin("https://mend.example.com"),
]);
const handler = createAuthHandler({
  network,
  secret: "test-secret-with-at-least-thirty-two-bytes",
});

const signIn = (origin: string, host = "spoofed.invalid") =>
  handler(
    new Request("http://untrusted-request-url.invalid/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host,
        origin,
        "x-forwarded-host": "forwarded-spoof.invalid",
        "x-forwarded-proto": "https",
      },
      body: JSON.stringify({ email: "nobody@example.com", password: "not-a-real-password" }),
    }),
  );

describe("the Better Auth origin policy", () => {
  it.each(network.allowedOrigins)(
    "creates an account and signs in with a cookie through %s",
    async (origin) => {
      const isolatedHandler = createAuthHandler({
        network,
        secret: "test-secret-with-at-least-thirty-two-bytes",
      });
      const credentials = {
        email: "network-test@example.invalid",
        password: "disposable-network-test-password",
      };
      const post = (route: string, body: object) =>
        isolatedHandler(
          new Request(`${origin}/api/auth/${route}`, {
            method: "POST",
            headers: { "content-type": "application/json", origin },
            body: JSON.stringify(body),
          }),
        );

      const created = await post("sign-up/email", { ...credentials, name: "Network test" });
      expect(created.status).toBe(200);
      const signedIn = await post("sign-in/email", credentials);
      expect(signedIn.status).toBe(200);
      expect(signedIn.headers.get("set-cookie")).toContain("session_token=");
      await expect(signedIn.json()).resolves.toMatchObject({
        user: { email: credentials.email },
      });
    },
  );

  it.each(["http://localhost:3105", "http://mac-mini.local:3105", "https://mend.example.com"])(
    "accepts the configured origin %s through Better Auth's real in-memory adapter",
    async (origin) => {
      const response = await signIn(origin);
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ code: "INVALID_EMAIL_OR_PASSWORD" });
    },
  );

  it.each([
    "http://mac-mini.local:3106",
    "https://mac-mini.local:3105",
    "http://unlisted.local:3105",
  ])("rejects unlisted origins with exact scheme, host, and port matching: %s", async (origin) => {
    const response = await signIn(origin, "mac-mini.local:3105");
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_ORIGIN" });
  });

  it("does not let Host or forwarded-header spoofing grant origin trust", async () => {
    const response = await signIn("http://evil.invalid:3105", "mac-mini.local:3105");
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_ORIGIN" });
  });

  it("rejects Better Auth's ambient origin variable instead of creating a second allowlist", async () => {
    const config = ConfigProvider.layer(
      ConfigProvider.fromUnknown({
        BETTER_AUTH_SECRET: "test-secret-with-at-least-thirty-two-bytes",
        BETTER_AUTH_TRUSTED_ORIGINS: "http://evil.invalid:3105",
        DATABASE_URL: "postgres://mend:mend@localhost:5434/mend",
      }),
    );
    const networkLayer = Layer.succeed(NetworkConfig, network);
    const result = await Effect.runPromise(
      Layer.build(AuthLive.pipe(Layer.provide(networkLayer), Layer.provide(config))).pipe(
        Effect.scoped,
        Effect.result,
      ),
    );
    expect(Result.isFailure(result)).toBe(true);
    expect(String(result)).toContain("BETTER_AUTH_TRUSTED_ORIGINS");
  });
});

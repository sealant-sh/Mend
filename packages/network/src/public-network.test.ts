import { describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Result, Schema } from "effect";

import {
  DEFAULT_APP_URL,
  isAllowedOrigin,
  loadPublicNetwork,
  makePublicNetwork,
  PublicOrigin,
} from "./public-network.ts";

const decodeOrigin = Schema.decodeUnknownSync(PublicOrigin);

const loadWith = (values: Record<string, unknown>) =>
  loadPublicNetwork.pipe(
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(values))),
    Effect.result,
  );

describe("PublicOrigin", () => {
  it("accepts canonical HTTP and HTTPS origins", () => {
    expect(decodeOrigin("http://localhost:3105")).toBe("http://localhost:3105");
    expect(decodeOrigin("https://mend.example.com")).toBe("https://mend.example.com");
    expect(decodeOrigin("http://[::1]:3105")).toBe("http://[::1]:3105");
  });

  it.each([
    "ftp://mend.example.com",
    "https://user:secret@mend.example.com",
    "https://mend.example.com/",
    "https://mend.example.com/path",
    "https://mend.example.com?query=yes",
    "https://mend.example.com#fragment",
    "https://*.example.com",
    "http://0.0.0.0:3105",
    "HTTP://MEND.EXAMPLE.COM:443",
  ])("rejects non-origin or non-canonical input %s", (input) => {
    expect(() => decodeOrigin(input)).toThrow();
  });
});

describe("public network configuration", () => {
  it.effect("defaults to the web server's localhost origin", () =>
    Effect.gen(function* () {
      const result = yield* loadWith({});
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success).toEqual({
          appUrl: DEFAULT_APP_URL,
          allowedOrigins: [DEFAULT_APP_URL],
        });
      }
    }),
  );

  it.effect("parses a JSON array, keeps APP_URL first, and removes repeats", () =>
    Effect.gen(function* () {
      const result = yield* loadWith({
        APP_URL: "http://mac-mini.local:3105",
        MEND_ALLOWED_ORIGINS:
          '["http://192.168.1.20:3105","http://mac-mini.local:3105","https://mend.example.com"]',
      });
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.allowedOrigins).toEqual([
          "http://mac-mini.local:3105",
          "http://192.168.1.20:3105",
          "https://mend.example.com",
        ]);
      }
    }),
  );

  it.effect("fails malformed JSON and invalid entries instead of falling back", () =>
    Effect.gen(function* () {
      const malformed = yield* loadWith({ MEND_ALLOWED_ORIGINS: "localhost:3105" });
      const invalidEntry = yield* loadWith({
        MEND_ALLOWED_ORIGINS: '["http://localhost:3105/path"]',
      });
      expect(Result.isFailure(malformed)).toBe(true);
      expect(Result.isFailure(invalidEntry)).toBe(true);
    }),
  );

  it("matches origins exactly, including scheme and port", () => {
    const network = makePublicNetwork(decodeOrigin("http://localhost:3105"), [
      decodeOrigin("https://mac-mini.local:3105"),
    ]);
    expect(isAllowedOrigin(network, "https://mac-mini.local:3105")).toBe(true);
    expect(isAllowedOrigin(network, "http://mac-mini.local:3105")).toBe(false);
    expect(isAllowedOrigin(network, "https://mac-mini.local:3106")).toBe(false);
    expect(isAllowedOrigin(network, "https://mac-mini.local:3105/path")).toBe(false);
  });
});

import { Schema } from "effect";
import { HttpApi } from "effect/unstable/httpapi";
import { describe, expect, it } from "vitest";

import { MendApi, PairClaimRequest } from "./contract.ts";
import {
  DEVICE_TOKEN_PREFIX,
  claimAddress,
  PAIRING_ALPHABET,
  PAIRING_CODE_LENGTH,
  generatePairingCode,
  groupPairingCode,
  hashDeviceToken,
  makeClaimLimiter,
  mintDeviceToken,
  normalisePairingCode,
} from "./devices.ts";

describe("pairing codes", () => {
  it("draws every character from the unambiguous alphabet", () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const code = generatePairingCode();
      expect(code).toHaveLength(PAIRING_CODE_LENGTH);
      for (const character of code) expect(PAIRING_ALPHABET).toContain(character);
    }
  });

  it("excludes the shapes people mistype", () => {
    for (const character of "01OIL") expect(PAIRING_ALPHABET).not.toContain(character);
  });

  it("discards biased bytes rather than folding them", () => {
    // 240..255 would fold onto the first ten characters; they must be skipped.
    const bytes = [250, 251, 252, 253, 254, 255, 0, 1, 2, 3, 4, 5, 6, 7];
    let offset = 0;
    const code = generatePairingCode((count) => {
      const slice = bytes.slice(offset, offset + count);
      offset += count;
      return Uint8Array.from(slice);
    });
    expect(code).toBe("23456789");
  });

  it("normalises dashes, spaces and case to the stored form", () => {
    expect(normalisePairingCode("abcd-efgh")).toBe("ABCDEFGH");
    expect(normalisePairingCode(" ABCD efgh ")).toBe("ABCDEFGH");
    expect(normalisePairingCode("ABCD-EFGH")).toBe("ABCDEFGH");
  });

  it("groups a code for reading aloud without changing what is stored", () => {
    expect(groupPairingCode("ABCDEFGH")).toBe("ABCD-EFGH");
    expect(normalisePairingCode(groupPairingCode("ABCDEFGH"))).toBe("ABCDEFGH");
    expect(groupPairingCode("SHORT")).toBe("SHORT");
  });
});

describe("device tokens", () => {
  it("mints a prefixed, unguessable token", () => {
    const token = mintDeviceToken();
    expect(token.startsWith(DEVICE_TOKEN_PREFIX)).toBe(true);
    // 32 bytes base64url — no padding, and never the same twice.
    expect(token.slice(DEVICE_TOKEN_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mintDeviceToken()).not.toBe(token);
  });

  it("stores a sha256 hex digest, never the token", () => {
    const hash = hashDeviceToken("mdt_example");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("mdt_");
    expect(hashDeviceToken("mdt_example")).toBe(hash);
  });
});

describe("claim rate limit", () => {
  it("lets ten failures a minute through and then answers with a wait", () => {
    const limiter = makeClaimLimiter();
    const start = 1_000_000;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(limiter.retryAfter("10.0.0.1", start)).toBeNull();
      limiter.recordFailure("10.0.0.1", start);
    }
    expect(limiter.retryAfter("10.0.0.1", start)).toBe(60);
    // The budget is per address.
    expect(limiter.retryAfter("10.0.0.2", start)).toBeNull();
  });

  it("frees the address again once the window has rolled past", () => {
    const limiter = makeClaimLimiter();
    const start = 1_000_000;
    for (let attempt = 0; attempt < 10; attempt += 1) limiter.recordFailure("10.0.0.1", start);
    expect(limiter.retryAfter("10.0.0.1", start + 30_000)).toBe(30);
    expect(limiter.retryAfter("10.0.0.1", start + 60_001)).toBeNull();
  });
});

describe("who a failed claim is counted against", () => {
  it("keys on the socket address when the claim arrived on one", () => {
    expect(claimAddress("10.0.0.4", undefined)).toBe("10.0.0.4");
    // A header from a direct client is its own word for itself: ignored.
    expect(claimAddress("10.0.0.4", "203.0.113.9")).toBe("10.0.0.4");
  });

  it("keys on the forwarded client when a proxy made every claim loopback", () => {
    expect(claimAddress("127.0.0.1", "203.0.113.9, 10.0.0.1")).toBe("203.0.113.9");
    expect(claimAddress("::1", " 203.0.113.9 ")).toBe("203.0.113.9");
    expect(claimAddress("::ffff:127.0.0.1", "203.0.113.9")).toBe("203.0.113.9");
  });

  it("falls back to the address when there is nothing better", () => {
    expect(claimAddress("127.0.0.1", undefined)).toBe("127.0.0.1");
    expect(claimAddress("127.0.0.1", "  ")).toBe("127.0.0.1");
    expect(claimAddress(undefined, undefined)).toBe("unknown");
    expect(claimAddress(undefined, "203.0.113.9")).toBe("203.0.113.9");
  });
});

describe("the pairing contract", () => {
  it("keeps unknown, spent and rate-limited as separate statuses", () => {
    const statuses = new Map<string, ReadonlySet<number>>();
    HttpApi.reflect(MendApi, {
      onGroup: () => {},
      onEndpoint: ({ endpoint, errors }) => {
        statuses.set(endpoint.name, new Set(errors.keys()));
      },
    });
    const claim = statuses.get("claim");
    expect(claim?.has(404)).toBe(true);
    expect(claim?.has(410)).toBe(true);
    expect(claim?.has(429)).toBe(true);
    expect(claim?.has(500)).toBe(false);
    expect(statuses.get("revoke")?.has(404)).toBe(true);
  });

  it("accepts only the platforms a device can report", () => {
    const decode = Schema.decodeUnknownSync(PairClaimRequest);
    expect(decode({ code: "ABCD-EFGH", name: "phone", platform: "ios" }).platform).toBe("ios");
    expect(() => decode({ code: "ABCD-EFGH", name: "phone", platform: "watch" })).toThrow();
  });
});

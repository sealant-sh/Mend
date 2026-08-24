import { createHash, randomBytes } from "node:crypto";

import {
  CurrentUser,
  DeviceView,
  MendApi,
  NotFound,
  PairClaimResult,
  PairingCodeNotFound,
  PairingCodeSpent,
  PairingRateLimited,
  PairingView,
} from "@mend/api-contracts";
import { DevicesRepo, DevicesRepoLive, type PairedDevice } from "@mend/db";
import { Config, Effect, Layer, Option } from "effect";
import { HttpServerRequest } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { candidateBaseUrls } from "./machine.ts";

/**
 * Device pairing: the operator mints a code on a machine they are signed in on,
 * a phone claims it once, and the claim hands back a bearer token that Mend
 * stores only as a hash. The code is short enough to type and short-lived
 * enough that reading it aloud is the whole security model it needs.
 */

/** Crockford base32 minus the shapes people mistype: 0, O, 1, I and L are all absent. */
export const PAIRING_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

export const PAIRING_CODE_LENGTH = 8;

/** Ten minutes: long enough to walk to the phone, short enough to be worthless later. */
export const PAIRING_TTL_MS = 10 * 60 * 1000;

export const DEVICE_TOKEN_PREFIX = "mdt_";

/** A code as stored and compared: upper case, dashes and spaces stripped. */
export const normalisePairingCode = (input: string): string =>
  input.toUpperCase().replaceAll(/[^0-9A-Z]/g, "");

/** "ABCDEFGH" → "ABCD-EFGH". The grouping is for reading aloud, never for storage. */
export const groupPairingCode = (code: string): string =>
  code.length === PAIRING_CODE_LENGTH ? `${code.slice(0, 4)}-${code.slice(4)}` : code;

/**
 * A code drawn uniformly from the alphabet: bytes at or above the largest whole
 * multiple of the alphabet length are discarded rather than folded, so no
 * character is more likely than any other.
 */
export const generatePairingCode = (
  bytes: (count: number) => Uint8Array = (count) => randomBytes(count),
): string => {
  const limit = 256 - (256 % PAIRING_ALPHABET.length);
  let code = "";
  while (code.length < PAIRING_CODE_LENGTH) {
    for (const byte of bytes(PAIRING_CODE_LENGTH)) {
      if (byte >= limit) continue;
      code += PAIRING_ALPHABET.charAt(byte % PAIRING_ALPHABET.length);
      if (code.length === PAIRING_CODE_LENGTH) break;
    }
  }
  return code;
};

/** The token handed to the claimer once. 32 random bytes, base64url, prefixed so it is recognisable. */
export const mintDeviceToken = (): string =>
  `${DEVICE_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;

/**
 * What is kept at rest. `packages/auth` computes the same hash on the way in —
 * the two must stay identical, which is why it is one line of stock sha256.
 */
export const hashDeviceToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

/**
 * `/pair` is unauthenticated by construction, so failed claims are counted per
 * address: ten a minute buys an attacker nothing against a 30^8 code space.
 * In-memory on purpose — the floor should cost nothing and survive nothing.
 */
export interface ClaimLimiter {
  /** Seconds to wait when the address is over its budget, null when it is not. */
  readonly retryAfter: (address: string, now: number) => number | null;
  readonly recordFailure: (address: string, now: number) => void;
}

const LIMITER_SWEEP_SIZE = 1_000;

export const makeClaimLimiter = (max = 10, windowMs = 60_000): ClaimLimiter => {
  const failures = new Map<string, ReadonlyArray<number>>();

  const recent = (address: string, now: number): ReadonlyArray<number> => {
    const kept = (failures.get(address) ?? []).filter((at) => now - at < windowMs);
    if (kept.length === 0) failures.delete(address);
    else failures.set(address, kept);
    return kept;
  };

  return {
    retryAfter: (address, now) => {
      const kept = recent(address, now);
      const oldest = kept[0];
      if (kept.length < max || oldest === undefined) return null;
      return Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
    },
    recordFailure: (address, now) => {
      // Rotating addresses would otherwise grow the map without bound. Deleting
      // during iteration is defined behaviour for a Map.
      if (failures.size > LIMITER_SWEEP_SIZE) {
        for (const key of failures.keys()) recent(key, now);
      }
      failures.set(address, [...recent(address, now), now]);
    },
  };
};

const claimLimiter = makeClaimLimiter();

const isLoopbackAddress = (address: string): boolean => {
  const bare = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
  return bare === "::1" || bare.startsWith("127.");
};

/**
 * What a failed claim is counted against. Behind a proxy — `tailscale serve`, caddy, nginx — every
 * claim arrives from loopback, which would put every phone in the house on one budget and let one
 * bogus sender lock pairing for all of them. When the socket is loopback and a forwarding header is
 * present, the first entry of that header is the honest key; a direct socket is trusted over any
 * header, which a client can write for itself.
 */
export const claimAddress = (
  remoteAddress: string | undefined,
  forwardedFor: string | undefined,
): string => {
  const address = remoteAddress ?? "unknown";
  if (remoteAddress !== undefined && !isLoopbackAddress(remoteAddress)) return address;
  const client = forwardedFor?.split(",")[0]?.trim();
  return client === undefined || client === "" ? address : client;
};

const serverPort = Config.int("PORT").pipe(Config.orElse(() => Config.succeed(3105)));

const toDeviceView = (device: PairedDevice): DeviceView =>
  new DeviceView({
    id: device.id,
    name: device.name,
    platform: device.platform,
    createdAt: device.createdAt.toISOString(),
    lastUsedAt: device.lastUsedAt === null ? null : device.lastUsedAt.toISOString(),
  });

/** The URL this request actually arrived on — what the claimer should keep using. */
const arrivalUrl = (request: HttpServerRequest.HttpServerRequest, port: number): string => {
  const host = request.headers["host"];
  const forwarded = request.headers["x-forwarded-proto"]?.split(",")[0]?.trim();
  const scheme = forwarded === "https" || forwarded === "http" ? forwarded : "http";
  if (host === undefined || host === "") {
    return candidateBaseUrls(port)[0] ?? `http://localhost:${port}`;
  }
  return `${scheme}://${host}`;
};

/**
 * Both pairing groups, built over one repo resolved at layer construction: an
 * HttpApi handler that yields a service turns it into a per-request requirement
 * the serve boundary has to satisfy, and this pairing owns its own storage.
 */
const devicePairingGroups = Effect.gen(function* () {
  const devices = yield* DevicesRepo;

  const userDevices = HttpApiBuilder.group(MendApi, "userDevices", (handlers) =>
    handlers
      .handle("createPairing", () =>
        Effect.gen(function* () {
          const caller = yield* CurrentUser;
          const port = yield* serverPort.pipe(Effect.orDie);
          const pairing = yield* devices.createPairing({
            userId: caller.user.id,
            code: generatePairingCode(),
            expiresAt: new Date(Date.now() + PAIRING_TTL_MS),
          });
          return new PairingView({
            code: pairing.code,
            expiresAt: pairing.expiresAt.toISOString(),
            urls: candidateBaseUrls(port),
          });
        }),
      )
      .handle("list", () =>
        Effect.gen(function* () {
          const caller = yield* CurrentUser;
          const rows = yield* devices.list(caller.user.id);
          return rows.map(toDeviceView);
        }),
      )
      .handle("revoke", ({ params }) =>
        Effect.gen(function* () {
          const caller = yield* CurrentUser;
          const device = yield* devices
            .revoke(caller.user.id, params.id)
            .pipe(Effect.mapError(() => new NotFound({ id: params.id })));
          return toDeviceView(device);
        }),
      ),
  );

  const pair = HttpApiBuilder.group(MendApi, "pair", (handlers) =>
    handlers.handle("claim", ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const port = yield* serverPort.pipe(Effect.orDie);
        const address = claimAddress(
          Option.getOrUndefined(request.remoteAddress),
          request.headers["x-forwarded-for"],
        );

        const retryAfterSeconds = claimLimiter.retryAfter(address, Date.now());
        if (retryAfterSeconds !== null) {
          return yield* Effect.fail(new PairingRateLimited({ retryAfterSeconds }));
        }

        const name = payload.name.trim();
        const token = mintDeviceToken();
        const claimed = yield* devices
          .claim({
            code: normalisePairingCode(payload.code),
            name: name === "" ? payload.platform : name,
            platform: payload.platform,
            tokenHash: hashDeviceToken(token),
          })
          .pipe(
            Effect.tapError(() =>
              Effect.sync(() => claimLimiter.recordFailure(address, Date.now())),
            ),
            Effect.catchTag("PairingCodeUnknownError", () =>
              Effect.fail(new PairingCodeNotFound()),
            ),
            Effect.catchTag("PairingCodeSpentError", () => Effect.fail(new PairingCodeSpent())),
          );

        return new PairClaimResult({
          token,
          url: arrivalUrl(request, port),
          user: { id: claimed.user.id, name: claimed.user.name, email: claimed.user.email },
          device: { id: claimed.device.id, name: claimed.device.name },
        });
      }),
    ),
  );

  return Layer.mergeAll(userDevices, pair);
});

export const DevicePairingLive = Layer.unwrap(devicePairingGroups).pipe(
  Layer.provide(DevicesRepoLive),
);

import { PgClient } from "@effect/sql-pg";
import { and, desc, eq, gt, isNull, lt } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

import { MendDB } from "../client.ts";
import { deviceTokens, pairingCodes } from "../schema/workbench.ts";

/**
 * How long an expired pairing code is kept before minting sweeps it away. Long
 * enough that a code someone reads off a stale screen still answers "expired"
 * rather than "no such code".
 */
export const PAIRING_SWEEP_GRACE_MS = 24 * 60 * 60 * 1000;

/** A device paired to one user. The token itself is never read back — only its sha256 is stored. */
export class PairedDevice extends Schema.Class<PairedDevice>("PairedDevice")({
  id: Schema.String,
  name: Schema.String,
  platform: Schema.String,
  createdAt: Schema.Date,
  lastUsedAt: Schema.NullOr(Schema.Date),
}) {}

/** A pairing code as minted: the code and the moment it stops being claimable. */
export class PairingCode extends Schema.Class<PairingCode>("PairingCode")({
  code: Schema.String,
  expiresAt: Schema.Date,
}) {}

/** The account a device is paired to — better-auth's `user` row, read as plain SQL. */
export class DeviceOwner extends Schema.Class<DeviceOwner>("DeviceOwner")({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
}) {}

/** What a claim produced: the code's owner and the device row it minted. */
export class ClaimedPairing extends Schema.Class<ClaimedPairing>("ClaimedPairing")({
  user: DeviceOwner,
  device: PairedDevice,
}) {}

/** No pairing code with that value exists. */
export class PairingCodeUnknownError extends Schema.TaggedErrorClass<PairingCodeUnknownError>()(
  "PairingCodeUnknownError",
  {},
) {}

/** The code exists but is spent: past its expiry, or already claimed. */
export class PairingCodeSpentError extends Schema.TaggedErrorClass<PairingCodeSpentError>()(
  "PairingCodeSpentError",
  {},
) {}

/** No such device for this user. */
export class DeviceNotFoundError extends Schema.TaggedErrorClass<DeviceNotFoundError>()(
  "DeviceNotFoundError",
  { id: Schema.String },
) {}

/**
 * Device pairing: a signed-in user mints a short-lived code, a phone claims it
 * once, and the claim mints a bearer token whose hash is all that is kept.
 */
export class DevicesRepo extends Context.Service<
  DevicesRepo,
  {
    readonly createPairing: (input: {
      readonly userId: string;
      readonly code: string;
      readonly expiresAt: Date;
    }) => Effect.Effect<PairingCode>;
    readonly claim: (input: {
      readonly code: string;
      readonly name: string;
      readonly platform: string;
      readonly tokenHash: string;
    }) => Effect.Effect<ClaimedPairing, PairingCodeUnknownError | PairingCodeSpentError>;
    readonly list: (userId: string) => Effect.Effect<ReadonlyArray<PairedDevice>>;
    readonly revoke: (
      userId: string,
      id: string,
    ) => Effect.Effect<PairedDevice, DeviceNotFoundError>;
  }
>()("@mend/db/DevicesRepo") {}

const selectedDevice = {
  id: deviceTokens.id,
  name: deviceTokens.name,
  platform: deviceTokens.platform,
  createdAt: deviceTokens.createdAt,
  lastUsedAt: deviceTokens.lastUsedAt,
};

export const DevicesRepoLive: Layer.Layer<DevicesRepo, never, MendDB | PgClient.PgClient> =
  Layer.effect(
    DevicesRepo,
    Effect.gen(function* () {
      const db = yield* MendDB;
      // better-auth owns the `user` schema, so the owner lookup stays plain SQL.
      const sql = yield* PgClient.PgClient;

      // Minting sweeps codes long past their expiry. The day of grace is what
      // makes the difference between "expired" and "not found" legible: a code
      // deleted at the expiry boundary reads back as a typo, so a recently
      // expired row is kept around to answer for itself.
      const createPairing = Effect.fn("DevicesRepo.createPairing")(function* (input: {
        readonly userId: string;
        readonly code: string;
        readonly expiresAt: Date;
      }) {
        yield* db
          .delete(pairingCodes)
          .where(lt(pairingCodes.expiresAt, new Date(Date.now() - PAIRING_SWEEP_GRACE_MS)))
          .pipe(Effect.orDie);
        const [row] = yield* db
          .insert(pairingCodes)
          .values({
            id: crypto.randomUUID(),
            userId: input.userId,
            code: input.code,
            expiresAt: input.expiresAt,
          })
          .returning({ code: pairingCodes.code, expiresAt: pairingCodes.expiresAt })
          .pipe(Effect.orDie);
        if (row === undefined) return yield* Effect.die("pairing code insert returned no row");
        return new PairingCode(row);
      });

      // Single use is the UPDATE's own WHERE clause: two claimants racing the
      // same code produce exactly one winner, and the loser reads as spent.
      const claim = Effect.fn("DevicesRepo.claim")(function* (input: {
        readonly code: string;
        readonly name: string;
        readonly platform: string;
        readonly tokenHash: string;
      }) {
        const now = new Date();
        const [claimedCode] = yield* db
          .update(pairingCodes)
          .set({ claimedAt: now })
          .where(
            and(
              eq(pairingCodes.code, input.code),
              isNull(pairingCodes.claimedAt),
              gt(pairingCodes.expiresAt, now),
            ),
          )
          .returning({ userId: pairingCodes.userId })
          .pipe(Effect.orDie);

        if (claimedCode === undefined) {
          const [existing] = yield* db
            .select({ id: pairingCodes.id })
            .from(pairingCodes)
            .where(eq(pairingCodes.code, input.code))
            .pipe(Effect.orDie);
          return yield* existing === undefined
            ? Effect.fail(new PairingCodeUnknownError())
            : Effect.fail(new PairingCodeSpentError());
        }

        const ownerRows = yield* sql`
        SELECT id, email, name FROM "user" WHERE id = ${claimedCode.userId} LIMIT 1`.pipe(
          Effect.orDie,
        );
        const owner = ownerRows[0] as
          | { readonly id: string; readonly email: string; readonly name: string }
          | undefined;
        if (owner === undefined) return yield* Effect.die("pairing code has no owner");

        const [device] = yield* db
          .insert(deviceTokens)
          .values({
            id: crypto.randomUUID(),
            userId: claimedCode.userId,
            name: input.name,
            platform: input.platform,
            tokenHash: input.tokenHash,
          })
          .returning(selectedDevice)
          .pipe(Effect.orDie);
        if (device === undefined) return yield* Effect.die("device token insert returned no row");

        return new ClaimedPairing({
          user: new DeviceOwner({ id: owner.id, name: owner.name, email: owner.email }),
          device: new PairedDevice(device),
        });
      });

      const list = Effect.fn("DevicesRepo.list")(function* (userId: string) {
        const rows = yield* db
          .select(selectedDevice)
          .from(deviceTokens)
          .where(and(eq(deviceTokens.userId, userId), isNull(deviceTokens.revokedAt)))
          .orderBy(desc(deviceTokens.createdAt))
          .pipe(Effect.orDie);
        return rows.map((row) => new PairedDevice(row));
      });

      // Revoking is idempotent: a device already revoked still answers as itself.
      const revoke = Effect.fn("DevicesRepo.revoke")(function* (userId: string, id: string) {
        const [row] = yield* db
          .update(deviceTokens)
          .set({ revokedAt: new Date() })
          .where(and(eq(deviceTokens.id, id), eq(deviceTokens.userId, userId)))
          .returning(selectedDevice)
          .pipe(Effect.orDie);
        if (row === undefined) return yield* Effect.fail(new DeviceNotFoundError({ id }));
        return new PairedDevice(row);
      });

      return { createPairing, claim, list, revoke };
    }),
  );

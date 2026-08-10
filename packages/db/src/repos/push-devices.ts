import { eq } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

import { MendDB } from "../client.ts";
import { pushDevices } from "../schema/workbench.ts";

export class PushDevice extends Schema.Class<PushDevice>("PushDevice")({
  token: Schema.String,
  platform: Schema.String,
}) {}

/**
 * Phones registered for push notifications (Expo push tokens). The token is
 * the identity: registering again refreshes `last_seen_at`, and a token the
 * push service reports as dead is removed.
 */
export class PushDevicesRepo extends Context.Service<
  PushDevicesRepo,
  {
    readonly register: (token: string, platform: string) => Effect.Effect<PushDevice>;
    readonly list: () => Effect.Effect<ReadonlyArray<PushDevice>>;
    readonly remove: (token: string) => Effect.Effect<void>;
  }
>()("@mend/db/PushDevicesRepo") {}

const selectedDevice = { token: pushDevices.token, platform: pushDevices.platform };
const toPushDevice = (row: { readonly token: string; readonly platform: string }): PushDevice =>
  new PushDevice(row);

export const PushDevicesRepoLive: Layer.Layer<PushDevicesRepo, never, MendDB> = Layer.effect(
  PushDevicesRepo,
  Effect.gen(function* () {
    const db = yield* MendDB;

    const register = Effect.fn("PushDevicesRepo.register")(function* (
      token: string,
      platform: string,
    ) {
      const [row] = yield* db
        .insert(pushDevices)
        .values({ token, platform })
        .onConflictDoUpdate({
          target: pushDevices.token,
          set: { platform, lastSeenAt: new Date() },
        })
        .returning(selectedDevice)
        .pipe(Effect.orDie);
      if (row === undefined) return yield* Effect.die("push device upsert returned no row");
      return toPushDevice(row);
    });

    const list = Effect.fn("PushDevicesRepo.list")(function* () {
      const rows = yield* db.select(selectedDevice).from(pushDevices).pipe(Effect.orDie);
      return rows.map(toPushDevice);
    });

    const remove = Effect.fn("PushDevicesRepo.remove")(function* (token: string) {
      yield* db.delete(pushDevices).where(eq(pushDevices.token, token)).pipe(Effect.orDie);
    });

    return { register, list, remove };
  }),
);

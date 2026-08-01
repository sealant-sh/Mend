import { PgClient } from "@effect/sql-pg";
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

export class PushDevice extends Schema.Class<PushDevice>("PushDevice")({
  token: Schema.String,
  platform: Schema.String,
}) {}

const decodeDevice = Schema.decodeUnknownEffect(PushDevice);

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
>()("@mend/db/PushDevicesRepo") {
  static readonly layer = Layer.effect(
    PushDevicesRepo,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;

      const decodeRow = (row: unknown) => decodeDevice(row).pipe(Effect.orDie);

      const register = Effect.fn("PushDevicesRepo.register")(function* (
        token: string,
        platform: string,
      ) {
        const rows = yield* sql`
          INSERT INTO push_devices (token, platform)
          VALUES (${token}, ${platform})
          ON CONFLICT (token) DO UPDATE SET platform = ${platform}, last_seen_at = now()
          RETURNING token, platform`.pipe(Effect.orDie);
        return yield* decodeRow(rows[0]);
      });

      const list = Effect.fn("PushDevicesRepo.list")(function* () {
        const rows = yield* sql`SELECT token, platform FROM push_devices`.pipe(Effect.orDie);
        return yield* Effect.forEach(rows, decodeRow);
      });

      const remove = Effect.fn("PushDevicesRepo.remove")(function* (token: string) {
        yield* sql`DELETE FROM push_devices WHERE token = ${token}`.pipe(Effect.orDie);
      });

      return { register, list, remove };
    }),
  );
}

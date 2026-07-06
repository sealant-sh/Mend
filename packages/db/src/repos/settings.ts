import { PgClient } from "@effect/sql-pg";
import { defaultSettings, MendSettings } from "@mend/domain";
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

const decodeSettings = Schema.decodeUnknownEffect(MendSettings);

/** Product settings live as one jsonb row; absence means the defaults. */
export class SettingsRepo extends Context.Service<
  SettingsRepo,
  {
    readonly get: () => Effect.Effect<MendSettings>;
    readonly set: (settings: MendSettings) => Effect.Effect<MendSettings>;
  }
>()("@mend/db/SettingsRepo") {
  static readonly layer = Layer.effect(
    SettingsRepo,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;

      const get = Effect.fn("SettingsRepo.get")(function* () {
        const rows = yield* sql`SELECT value FROM settings WHERE key = 'mend'`.pipe(Effect.orDie);
        const row = rows[0] as { value: unknown } | undefined;
        if (row === undefined) return defaultSettings;
        return yield* decodeSettings(row.value).pipe(Effect.orDie);
      });

      const set = Effect.fn("SettingsRepo.set")(function* (settings: MendSettings) {
        const encoded = yield* Schema.encodeEffect(MendSettings)(settings).pipe(Effect.orDie);
        yield* sql`
          INSERT INTO settings (key, value) VALUES ('mend', ${sql.json(encoded)})
          ON CONFLICT (key) DO UPDATE SET value = ${sql.json(encoded)}, updated_at = now()`.pipe(
          Effect.orDie,
        );
        return settings;
      });

      return { get, set };
    }),
  );
}

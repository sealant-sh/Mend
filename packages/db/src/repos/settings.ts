import { defaultSettings, MendSettings } from "@mend/domain";
import { eq } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

import { MendDB } from "../client.ts";
import { settings as settingsTable } from "../schema/workbench.ts";

const decodeSettings = Schema.decodeUnknownEffect(MendSettings);

/** Product settings live as one jsonb row; absence means the defaults. */
export class SettingsRepo extends Context.Service<
  SettingsRepo,
  {
    readonly get: () => Effect.Effect<MendSettings>;
    readonly set: (settings: MendSettings) => Effect.Effect<MendSettings>;
  }
>()("@mend/db/SettingsRepo") {}

export const SettingsRepoLive: Layer.Layer<SettingsRepo, never, MendDB> = Layer.effect(
  SettingsRepo,
  Effect.gen(function* () {
    const db = yield* MendDB;

    const get = Effect.fn("SettingsRepo.get")(function* () {
      const [row] = yield* db
        .select({ value: settingsTable.value })
        .from(settingsTable)
        .where(eq(settingsTable.key, "mend"))
        .limit(1)
        .pipe(Effect.orDie);
      if (row === undefined) return defaultSettings;
      return yield* decodeSettings(row.value).pipe(Effect.orDie);
    });

    const set = Effect.fn("SettingsRepo.set")(function* (settings: MendSettings) {
      const encoded = yield* Schema.encodeEffect(MendSettings)(settings).pipe(Effect.orDie);
      yield* db
        .insert(settingsTable)
        .values({ key: "mend", value: encoded })
        .onConflictDoUpdate({
          target: settingsTable.key,
          set: { value: encoded, updatedAt: new Date() },
        })
        .pipe(Effect.orDie);
      return settings;
    });

    return { get, set };
  }),
);

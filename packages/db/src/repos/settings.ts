import { defaultSettings, MendSettings } from "@mend/domain";
import { eq, sql } from "drizzle-orm";
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
    readonly modify: (
      update: (current: MendSettings) => MendSettings,
    ) => Effect.Effect<MendSettings>;
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

    const modify = Effect.fn("SettingsRepo.modify")(function* (
      update: (current: MendSettings) => MendSettings,
    ) {
      return yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            // The row may not exist yet, so a row lock alone cannot serialize
            // first-write races. This transaction-scoped lock covers that case.
            yield* tx.execute(sql`select pg_advisory_xact_lock(hashtext('mend:settings'))`);
            const [row] = yield* tx
              .select({ value: settingsTable.value })
              .from(settingsTable)
              .where(eq(settingsTable.key, "mend"))
              .limit(1)
              .for("update");
            const current =
              row === undefined
                ? defaultSettings
                : yield* decodeSettings(row.value).pipe(Effect.orDie);
            const next = update(current);
            const encoded = yield* Schema.encodeEffect(MendSettings)(next).pipe(Effect.orDie);
            yield* tx
              .insert(settingsTable)
              .values({ key: "mend", value: encoded })
              .onConflictDoUpdate({
                target: settingsTable.key,
                set: { value: encoded, updatedAt: new Date() },
              });
            return next;
          }),
        )
        .pipe(Effect.orDie);
    });

    return { get, modify };
  }),
);

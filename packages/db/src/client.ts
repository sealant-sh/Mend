import { PgClient } from "@effect/sql-pg";
import { Config, Redacted, String as Str } from "effect";

/**
 * Postgres owns product state; Sealant owns raw recordings (ARCHITECTURE.md §3).
 * Tables/columns are snake_case; the client transforms to camelCase at the
 * boundary so rows decode straight into domain schemas.
 */
export const PgLive = PgClient.layerConfig({
  url: Config.redacted("DATABASE_URL").pipe(
    // The dev-compose default; every real deployment sets DATABASE_URL.
    Config.orElse(() => Config.succeed(Redacted.make("postgres://mend:mend@localhost:5434/mend"))),
  ),
  applicationName: Config.succeed("mend"),
  transformResultNames: Config.succeed(Str.snakeToCamel),
  transformQueryNames: Config.succeed(Str.camelToSnake),
});

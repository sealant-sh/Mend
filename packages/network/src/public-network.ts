import { Config, Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

const originFilter = Schema.makeFilter((value: string) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "a canonical HTTP(S) origin";
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "an HTTP or HTTPS origin";
  }
  if (url.username !== "" || url.password !== "") {
    return "an origin without credentials";
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    return "an origin without a path, query, or fragment";
  }
  if (url.hostname.includes("*") || url.hostname === "0.0.0.0" || url.hostname === "[::]") {
    return "a concrete host, not a wildcard or bind address";
  }
  if (url.origin !== value) {
    return `the canonical origin ${url.origin}`;
  }
  return undefined;
});

/** An exact, canonical HTTP(S) browser origin with no credentials or URL suffix. */
export const PublicOrigin = Schema.String.pipe(
  Schema.check(originFilter),
  Schema.brand("@mend/network/PublicOrigin"),
);

/** A parsed public browser origin. */
export type PublicOrigin = typeof PublicOrigin.Type;

/** The local web address used when setup has not selected another public address. */
export const DEFAULT_APP_URL = PublicOrigin.make("http://localhost:3105");

/** The public addresses that may authenticate to and display this Mend instance. */
export interface PublicNetwork {
  /** The address used for generated links when no allowed request address is available. */
  readonly appUrl: PublicOrigin;
  /** Every accepted browser origin, with `appUrl` first and duplicates removed. */
  readonly allowedOrigins: readonly [PublicOrigin, ...PublicOrigin[]];
}

/**
 * Combine the primary address and explicit alternates into the ordered allowlist used by Mend.
 */
export const makePublicNetwork = (
  appUrl: PublicOrigin,
  alternateOrigins: ReadonlyArray<PublicOrigin>,
): PublicNetwork => ({
  appUrl,
  allowedOrigins: [appUrl, ...new Set(alternateOrigins.filter((origin) => origin !== appUrl))],
});

/** Whether an untrusted Origin header exactly matches one configured public origin. */
export const isAllowedOrigin = (network: PublicNetwork, origin: string): boolean =>
  network.allowedOrigins.some((allowed) => allowed === origin);

const appUrlConfig = Config.schema(PublicOrigin, "APP_URL").pipe(
  Config.withDefault(DEFAULT_APP_URL),
);
const alternateOriginsConfig = Config.schema(
  Schema.fromJsonString(Schema.Array(PublicOrigin)),
  "MEND_ALLOWED_ORIGINS",
).pipe(Config.withDefault([]));

/** Decode `APP_URL` and the `MEND_ALLOWED_ORIGINS` JSON array from the active Config provider. */
export const loadPublicNetwork: Effect.Effect<PublicNetwork, Config.ConfigError> = Effect.gen(
  function* () {
    const appUrl = yield* appUrlConfig;
    const alternateOrigins = yield* alternateOriginsConfig;
    return makePublicNetwork(appUrl, alternateOrigins);
  },
);

/** Runtime authority for the public addresses accepted and displayed by this process. */
export class NetworkConfig extends Context.Service<NetworkConfig, PublicNetwork>()(
  "@mend/network/NetworkConfig",
) {}

/** Environment-backed public network configuration, decoded once when the layer starts. */
export const NetworkConfigLive: Layer.Layer<NetworkConfig, Config.ConfigError> = Layer.effect(
  NetworkConfig,
  loadPublicNetwork,
);

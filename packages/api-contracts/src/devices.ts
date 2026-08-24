import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

import { NotFound } from "./accounts.ts";
import { AuthMiddleware } from "./common.ts";
import { RegisterDeviceRequest, RegisteredDevice } from "./github.ts";

export const devicesGroup = HttpApiGroup.make("devices")
  .add(
    HttpApiEndpoint.post("register", "/devices", {
      payload: RegisterDeviceRequest,
      success: RegisteredDevice,
    }),
  )
  .add(
    HttpApiEndpoint.delete("unregister", "/devices/:token", {
      params: { token: Schema.String },
    }),
  )
  .middleware(AuthMiddleware);

/** The platforms a paired device can report itself as. */
export const DEVICE_PLATFORMS = ["ios", "android", "web", "desktop", "other"] as const;

/** One device paired to the signed-in user. Revoked devices drop off the list. */
export class DeviceView extends Schema.Class<DeviceView>("DeviceView")({
  id: Schema.String,
  name: Schema.String,
  platform: Schema.String,
  createdAt: Schema.String,
  lastUsedAt: Schema.NullOr(Schema.String),
}) {}

/**
 * A freshly minted pairing code plus the base URLs this machine answers on —
 * the tailnet address first, then non-internal LAN IPv4s. Reachability is the
 * phone's to observe; these are candidates, not a promise.
 */
export class PairingView extends Schema.Class<PairingView>("PairingView")({
  code: Schema.String,
  expiresAt: Schema.String,
  urls: Schema.Array(Schema.String),
}) {}

/** What a phone sends to claim a code: the code as typed, and what to call the device. */
export class PairClaimRequest extends Schema.Class<PairClaimRequest>("PairClaimRequest")({
  code: Schema.String,
  name: Schema.String,
  platform: Schema.Literals(DEVICE_PLATFORMS),
}) {}

/** The claimed token, shown once. Mend keeps only its sha256. */
export class PairClaimResult extends Schema.Class<PairClaimResult>("PairClaimResult")({
  token: Schema.String,
  url: Schema.String,
  user: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    email: Schema.String,
  }),
  device: Schema.Struct({ id: Schema.String, name: Schema.String }),
}) {}

/** No pairing code with that value. */
export class PairingCodeNotFound extends Schema.TaggedErrorClass<PairingCodeNotFound>()(
  "PairingCodeNotFound",
  {},
  { httpApiStatus: 404 },
) {}

/** The code exists but is spent — past its expiry, or already claimed. */
export class PairingCodeSpent extends Schema.TaggedErrorClass<PairingCodeSpent>()(
  "PairingCodeSpent",
  {},
  { httpApiStatus: 410 },
) {}

/** Too many failed claims from one address. `/pair` is unauthenticated; this is its floor. */
export class PairingRateLimited extends Schema.TaggedErrorClass<PairingRateLimited>()(
  "PairingRateLimited",
  { retryAfterSeconds: Schema.Int },
  { httpApiStatus: 429 },
) {}

/**
 * The signed-in user's paired devices, and the codes that mint them. A device
 * holds a bearer token of its own: revoking the device is what ends its access.
 */
export const userDevicesGroup = HttpApiGroup.make("userDevices")
  .add(HttpApiEndpoint.post("createPairing", "/me/devices/pairings", { success: PairingView }))
  .add(HttpApiEndpoint.get("list", "/me/devices", { success: Schema.Array(DeviceView) }))
  .add(
    HttpApiEndpoint.delete("revoke", "/me/devices/:id", {
      params: Schema.Struct({ id: Schema.String }),
      success: DeviceView,
      error: [NotFound],
    }),
  )
  .middleware(AuthMiddleware);

/**
 * Claiming a pairing code. Unauthenticated by construction — the code is the
 * only credential the phone has, and it is single use.
 */
export const pairGroup = HttpApiGroup.make("pair").add(
  HttpApiEndpoint.post("claim", "/pair", {
    payload: PairClaimRequest,
    success: PairClaimResult,
    error: [PairingCodeNotFound, PairingCodeSpent, PairingRateLimited],
  }),
);

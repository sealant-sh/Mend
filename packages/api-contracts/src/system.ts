import { SealantConnection } from "@mend/sealant";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

import { AuthMiddleware, HealthStatus } from "./common.ts";

export const healthGroup = HttpApiGroup.make("health").add(
  HttpApiEndpoint.get("status", "/health", { success: HealthStatus }),
);

/**
 * The machine Mend runs on, as the shell shows it: hostname · platform, and whether a
 * tailnet address is bound (plan §7.5 — the private-network promise made visible).
 * "reachable" is an observation about the interface, not a promise about routing.
 */
export class MachineView extends Schema.Class<MachineView>("MachineView")({
  hostname: Schema.String,
  platform: Schema.String,
  tailnet: Schema.Struct({
    status: Schema.Literals(["reachable", "not-detected"]),
    address: Schema.NullOr(Schema.String),
  }),
}) {}

export const machineGroup = HttpApiGroup.make("machine")
  .add(HttpApiEndpoint.get("get", "/machine", { success: MachineView }))
  .middleware(AuthMiddleware);

/** The settings page's connection check — reports what was observed, never a judgment. */
export const sealantGroup = HttpApiGroup.make("sealant")
  .add(HttpApiEndpoint.get("connection", "/sealant/connection", { success: SealantConnection }))
  .middleware(AuthMiddleware);

/** The platform refused the credential (format, a dead token, an unknown account). */
export class AccountRejected extends Schema.TaggedErrorClass<AccountRejected>()(
  "AccountRejected",
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}

/** The platform could not be reached or answered outside its contract. */
export class SealantUnavailable extends Schema.TaggedErrorClass<SealantUnavailable>()(
  "SealantUnavailable",
  { code: Schema.String, message: Schema.String },
  { httpApiStatus: 502 },
) {}

/**
 * The signed-in user's platform identity and connected accounts
 * (docs/SEALANT-IDENTITY.md). Secrets pass straight through to Sealant under
 * the user's own Sealant user; Mend never stores or echoes them.
 */

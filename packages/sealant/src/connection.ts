import { Schema } from "effect";

/**
 * What the settings page shows: what was observed when Mend last talked to the
 * control plane — never a judgment about it.
 */
export const SealantConnectionStatus = Schema.Literals([
  "connected",
  "unauthorized",
  /** The control plane responded, but not with the SDK surface Mend speaks. */
  "mismatched",
  "unreachable",
]);
export type SealantConnectionStatus = typeof SealantConnectionStatus.Type;

export class SealantConnection extends Schema.Class<SealantConnection>("SealantConnection")({
  status: SealantConnectionStatus,
  baseUrl: Schema.String,
  /** The observed failure, verbatim, when not connected. */
  detail: Schema.NullOr(Schema.String),
  checkedAt: Schema.Date,
}) {}

import { Schema } from "effect";

/**
 * PR timing has exactly two modes; there is no third.
 * Default: every successful run opens a draft PR immediately.
 */
export const PrMode = Schema.Literals(["draft-immediately", "pr-on-approval"]);
export type PrMode = typeof PrMode.Type;

export class MendSettings extends Schema.Class<MendSettings>("MendSettings")({
  prMode: PrMode,
  /** How many issues mend at once — the dispatcher fills free slots from the top of queued. */
  concurrency: Schema.Int,
}) {}

export const defaultSettings = new MendSettings({
  prMode: "draft-immediately",
  concurrency: 1,
});

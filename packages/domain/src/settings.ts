import { Effect, Schema } from "effect";

/**
 * PR timing has exactly two modes; there is no third.
 * Default: every successful run opens a draft PR immediately.
 */
export const PrMode = Schema.Literals(["draft-immediately", "pr-on-approval"]);
export type PrMode = typeof PrMode.Type;

/** Rows written before a switch existed decode to its default — never a failed read. */
const onByDefault = Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true)));

export class MendSettings extends Schema.Class<MendSettings>("MendSettings")({
  prMode: PrMode,
  /** How many issues mend at once — the dispatcher fills free slots from the top of queued. */
  concurrency: Schema.Int,
  /**
   * Review automation defaults — the machine-side prep that runs when a
   * session settles, so review opens ready. Each switch is overridable per
   * project (`inherit` follows these): the cascade is settings → project,
   * resolved per session at settle.
   */
  /** Compose the tour when a session settles — description and walkthrough ready before review opens. */
  autoTour: onByDefault,
  /** Run the suggestion pass when a session settles — strict, code-anchored; zero suggestions is normal. */
  autoSuggest: onByDefault,
}) {}

export const defaultSettings = new MendSettings({
  prMode: "draft-immediately",
  concurrency: 1,
  autoTour: true,
  autoSuggest: true,
});

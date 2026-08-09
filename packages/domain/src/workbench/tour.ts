import { Schema } from "effect";

import { ChangeId, SessionId } from "../ids.ts";
import { RecordLink } from "./review-comment.ts";

/**
 * One stop of the composed review tour (plan §7.3): a place in the change
 * worth the reviewer's attention, with the narration that accompanies it.
 * Anchors are NEW-file line coordinates; null file = a cross-cutting stop
 * (architecture, a theme spanning files). Claims in the narration either
 * carry evidence links into the session record or stand as the model's
 * reading — the `grounded` flag states which, honestly.
 */
export class TourStop extends Schema.Class<TourStop>("TourStop")({
  title: Schema.String,
  file: Schema.NullOr(Schema.String),
  /** The region to circle, new-file coordinates; null = the whole file. */
  line: Schema.NullOr(Schema.Int),
  endLine: Schema.NullOr(Schema.Int),
  /** What to look at, why it matters, what the record shows. */
  narration: Schema.String,
  /** Links into the session record backing the narration's claims. */
  evidence: Schema.Array(RecordLink),
  /** True when every claim traces to the record; false marks inferred reading. */
  grounded: Schema.Boolean,
}) {}

/**
 * The composed tour: Mend read the diff and the record and wrote the guided
 * review — a summary of what the change is, how the session went about it,
 * and an ordered walk through the places that matter. Derivative content by
 * definition (plan §9.3): it links to evidence or labels itself inferred; it
 * never verdicts. One tour per change, replaced on recompose; `diffDigest`
 * (sha256 of the diff text it read) lets clients say "the change moved since
 * this tour" instead of guiding the user through a stale map.
 */
export class ChangeTour extends Schema.Class<ChangeTour>("ChangeTour")({
  id: Schema.String,
  changeId: ChangeId,
  sessionId: SessionId,
  summary: Schema.String,
  /** How the session approached the work, as the record shows it. */
  approach: Schema.NullOr(Schema.String),
  stops: Schema.Array(TourStop),
  diffDigest: Schema.String,
  createdAt: Schema.Date,
}) {}

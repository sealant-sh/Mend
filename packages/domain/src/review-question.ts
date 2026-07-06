import { Schema } from "effect";

import { EvidencePointer } from "./evidence.ts";
import { BriefId, ReviewQuestionId } from "./ids.ts";

/**
 * Dispositions are earned: green means the recording contains direct evidence;
 * nothing defaults to green. Codes here, display words via `dispositionLabel`.
 */
export const Disposition = Schema.Literals(["direct-evidence", "not-executed", "unrelated-change"]);
export type Disposition = typeof Disposition.Type;

export const dispositionLabel: Record<Disposition, string> = {
  "direct-evidence": "direct evidence",
  "not-executed": "not executed",
  "unrelated-change": "unrelated change",
};

/** One numbered question of the decomposed review, carrying its disposition. */
export class ReviewQuestion extends Schema.Class<ReviewQuestion>("ReviewQuestion")({
  id: ReviewQuestionId,
  briefId: BriefId,
  index: Schema.Int,
  question: Schema.String,
  disposition: Disposition,
  evidence: Schema.Array(EvidencePointer),
}) {}

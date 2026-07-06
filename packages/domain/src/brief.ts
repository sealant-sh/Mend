import { Schema } from "effect";

import { Freshness } from "./change.ts";
import { EvidencePointer } from "./evidence.ts";
import { BriefId, ChangeId, Sha } from "./ids.ts";
import { Disposition } from "./review-question.ts";

/** Header facts: repo · PR ref · issue ref · checks · head sha · freshness. */
export class BriefHeader extends Schema.Class<BriefHeader>("BriefHeader")({
  repository: Schema.String,
  prRef: Schema.NullOr(Schema.String),
  issueRef: Schema.String,
  checksCount: Schema.NullOr(Schema.Int),
  headSha: Schema.NullOr(Sha),
  freshness: Freshness,
}) {}

/**
 * `base fails · head passes · revert fails` — each leg present only when it was
 * actually executed and observed. A missing leg is content, not an omission.
 */
export class CausalProof extends Schema.Class<CausalProof>("CausalProof")({
  baseFails: Schema.NullOr(EvidencePointer),
  headPasses: Schema.NullOr(EvidencePointer),
  revertFails: Schema.NullOr(EvidencePointer),
}) {}

/** A review question as it appears inside the compiled document. */
export class BriefQuestion extends Schema.Class<BriefQuestion>("BriefQuestion")({
  index: Schema.Int,
  question: Schema.String,
  disposition: Disposition,
  evidence: Schema.Array(EvidencePointer),
}) {}

/** An amber/red edge callout — first-class, never fine print. */
export class BriefCallout extends Schema.Class<BriefCallout>("BriefCallout")({
  severity: Schema.Literals(["not-executed", "unrelated-change"]),
  text: Schema.String,
  evidence: Schema.Array(EvidencePointer),
}) {}

/** One source in "Evidence used", with what it established. */
export class BriefEvidenceSource extends Schema.Class<BriefEvidenceSource>("BriefEvidenceSource")({
  source: Schema.String,
  established: Schema.String,
  pointers: Schema.Array(EvidencePointer),
}) {}

/**
 * The compiled review — one living document per change, recompiled after every
 * run and on freshness flips. Stored whole per version so "what did the brief
 * claim when I approved" stays answerable.
 */
export class BriefDocument extends Schema.Class<BriefDocument>("BriefDocument")({
  header: BriefHeader,
  causalProof: CausalProof,
  /** The issue restated in one line, with the failing reproduction in mono. */
  issueRestated: Schema.String,
  reproduction: Schema.NullOr(Schema.String),
  whatWasDone: Schema.String,
  statusNow: Schema.String,
  /** Mono facts, e.g. `3 files · +41 / −22 · no API, schema, dependency, or provider-contract changes`. */
  monoFacts: Schema.String,
  questions: Schema.Array(BriefQuestion),
  attention: Schema.Array(BriefCallout),
  evidenceUsed: Schema.Array(BriefEvidenceSource),
}) {
  /** Footer counts are derived, never stored — they cannot drift from the questions. */
  get footer(): { total: number; directEvidence: number; needJudgment: number } {
    const total = this.questions.length;
    const directEvidence = this.questions.filter((q) => q.disposition === "direct-evidence").length;
    return { total, directEvidence, needJudgment: total - directEvidence };
  }
}

/**
 * The brief belongs to the change — not to a run, not to the PR. Runs are many;
 * the change and its PR are one; the brief is one, and current.
 */
export class Brief extends Schema.Class<Brief>("Brief")({
  id: BriefId,
  changeId: ChangeId,
  currentVersion: Schema.Int,
  document: BriefDocument,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {}

/** Prior versions stay in history. */
export class BriefVersion extends Schema.Class<BriefVersion>("BriefVersion")({
  briefId: BriefId,
  version: Schema.Int,
  document: BriefDocument,
  createdAt: Schema.Date,
}) {}

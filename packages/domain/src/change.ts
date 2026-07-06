import { Schema } from "effect";

import { ChangeId, IssueId, Sha } from "./ids.ts";

/** A stale brief never silently presents itself as current. */
export const Freshness = Schema.Literals(["current", "stale"]);
export type Freshness = typeof Freshness.Type;

/**
 * The change is one per issue: one branch, at most one PR carrying it.
 * Follow-up runs commit to the same branch and the same PR.
 */
export class Change extends Schema.Class<Change>("Change")({
  id: ChangeId,
  issueId: IssueId,
  branch: Schema.String,
  /** The base the evidence was gathered against. */
  baseSha: Schema.NullOr(Sha),
  headSha: Schema.NullOr(Sha),
  prNumber: Schema.NullOr(Schema.Int),
  prUrl: Schema.NullOr(Schema.String),
  freshness: Freshness,
  /** Where base moved to while the brief sat in review — set only when stale. */
  movedBaseSha: Schema.NullOr(Sha),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {}

import { Schema } from "effect";

import { IssueId, RunId } from "./ids.ts";
import { Timestamp } from "./timestamp.ts";

/** The queue stages. Gate 1 is the human drag from triage into queued. */
export const IssueStage = Schema.Literals(["triage", "queued", "mending", "review", "merged"]);
export type IssueStage = typeof IssueStage.Type;

/** The tracker is an input, not the identity. Manual entry precedes the integrations. */
export const IssueSource = Schema.Literals(["manual", "github", "linear", "jira"]);
export type IssueSource = typeof IssueSource.Type;

export class Issue extends Schema.Class<Issue>("Issue")({
  id: IssueId,
  source: IssueSource,
  /** Tracker-side reference (e.g. `acme/billing#142`) — null for manual entry. */
  externalRef: Schema.NullOr(Schema.String),
  /** v1: single repository per issue. */
  repository: Schema.String,
  title: Schema.String,
  body: Schema.String,
  stage: IssueStage,
  /** Order within the queue — meaningful only while `stage === "queued"`. */
  position: Schema.NullOr(Schema.Int),
  /** A failed run returns the card to triage carrying the failure. */
  lastFailureRunId: Schema.NullOr(RunId),
  createdAt: Timestamp,
  updatedAt: Timestamp,
}) {}

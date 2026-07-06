import { Schema } from "effect";

import { ChangeId, IssueId, RunId, SealantRunId, SealantWorkspaceId } from "./ids.ts";

/** Initial run · follow-up runs · re-verification runs. Runs are many. */
export const RunKind = Schema.Literals(["initial", "follow-up", "verification"]);
export type RunKind = typeof RunKind.Type;

/** Mirrors the SDK's run lifecycle so status maps 1:1 from the platform. */
export const RunStatus = Schema.Literals(["queued", "running", "completed", "failed", "cancelled"]);
export type RunStatus = typeof RunStatus.Type;

export const RunOutcome = Schema.Literals(["completed", "failed"]);
export type RunOutcome = typeof RunOutcome.Type;

/**
 * One harness execution in one workspace, indexed in Postgres. The recording
 * itself stays in Sealant; Mend addresses it by `(sealantRunId, sequence)`.
 */
export class Run extends Schema.Class<Run>("Run")({
  id: RunId,
  issueId: IssueId,
  changeId: Schema.NullOr(ChangeId),
  kind: RunKind,
  sealantRunId: Schema.NullOr(SealantRunId),
  sealantWorkspaceId: Schema.NullOr(SealantWorkspaceId),
  status: RunStatus,
  outcome: Schema.NullOr(RunOutcome),
  summary: Schema.NullOr(Schema.String),
  /** Last record sequence the supervisor persisted — crash-resume re-attaches from here. */
  lastSeenSequence: Schema.BigInt,
  startedAt: Schema.NullOr(Schema.Date),
  settledAt: Schema.NullOr(Schema.Date),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {}

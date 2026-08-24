import { Issue, Run } from "@mend/domain";
import { ConnectAccountInput, ConnectedAccount, SealantIdentity } from "@mend/sealant";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

import { AuthMiddleware } from "./common.ts";
import { AccountRejected, SealantUnavailable } from "./system.ts";

export const accountsGroup = HttpApiGroup.make("accounts")
  .add(
    HttpApiEndpoint.get("identity", "/me/sealant", {
      success: SealantIdentity,
      error: [SealantUnavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post("connect", "/me/sealant/accounts", {
      payload: ConnectAccountInput,
      success: ConnectedAccount,
      error: [AccountRejected, SealantUnavailable],
    }),
  )
  .add(
    HttpApiEndpoint.delete("disconnect", "/me/sealant/accounts/:id", {
      params: Schema.Struct({ id: Schema.String }),
      success: ConnectedAccount,
      error: [AccountRejected, SealantUnavailable],
    }),
  )
  .middleware(AuthMiddleware);

export class NotFound extends Schema.TaggedErrorClass<NotFound>()(
  "NotFound",
  { id: Schema.String },
  { httpApiStatus: 404 },
) {}

export class IssueDetail extends Schema.Class<IssueDetail>("IssueDetail")({
  issue: Issue,
  runs: Schema.Array(Run),
}) {}

/** One terminal command the run executed, from the SDK's read surface. */
export class RunCommandView extends Schema.Class<RunCommandView>("RunCommandView")({
  command: Schema.String,
  exitCode: Schema.NullOr(Schema.Int),
  durationMs: Schema.NullOr(Schema.Number),
}) {}

/** A telemetry gap, straight from the record's loss report — never fabricated. */
export class LossSpanView extends Schema.Class<LossSpanView>("LossSpanView")({
  fromSequence: Schema.NullOr(Schema.String),
  toSequence: Schema.NullOr(Schema.String),
}) {}

/** Provenance-honest: `complete` or the exact spans that were dropped. */
export class LossReportView extends Schema.Class<LossReportView>("LossReportView")({
  complete: Schema.Boolean,
  spans: Schema.Array(LossSpanView),
}) {}

/**
 * The run detail: the indexed row plus what the record can already show
 * (commands · transcript · loss). `recordError` carries the observed failure
 * when the recording could not be read — a gap is content, not an omission.
 */
export class RunDetail extends Schema.Class<RunDetail>("RunDetail")({
  run: Run,
  commands: Schema.Array(RunCommandView),
  transcript: Schema.NullOr(Schema.String),
  loss: Schema.NullOr(LossReportView),
  recordError: Schema.NullOr(Schema.String),
}) {}

/** One timeline entry of the full trace, summary-first (typed data stays platform-side). */
export class TraceEntryView extends Schema.Class<TraceEntryView>("TraceEntryView")({
  sequence: Schema.String,
  occurredAt: Schema.String,
  kind: Schema.String,
  summary: Schema.String,
  processId: Schema.NullOr(Schema.String),
}) {}

/** A page of the full trace; `nextFrom` resumes where this page ended. */
export class TracePage extends Schema.Class<TracePage>("TracePage")({
  entries: Schema.Array(TraceEntryView),
  nextFrom: Schema.NullOr(Schema.String),
}) {}

/** One network source the run touched, aggregated from the record's source events. */
export class RunSourceView extends Schema.Class<RunSourceView>("RunSourceView")({
  host: Schema.String,
  method: Schema.NullOr(Schema.String),
  path: Schema.NullOr(Schema.String),
  status: Schema.NullOr(Schema.Int),
  count: Schema.Int,
  firstSequence: Schema.String,
}) {}

/** The queue: list, manual entry into triage, the Gate 1 drag, the detail views. */

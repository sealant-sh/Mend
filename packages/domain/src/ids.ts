import { Schema } from "effect";

export const IssueId = Schema.String.pipe(Schema.brand("IssueId"));
export type IssueId = typeof IssueId.Type;

export const ChangeId = Schema.String.pipe(Schema.brand("ChangeId"));
export type ChangeId = typeof ChangeId.Type;

export const RunId = Schema.String.pipe(Schema.brand("RunId"));
export type RunId = typeof RunId.Type;

export const BriefId = Schema.String.pipe(Schema.brand("BriefId"));
export type BriefId = typeof BriefId.Type;

export const ReviewQuestionId = Schema.String.pipe(Schema.brand("ReviewQuestionId"));
export type ReviewQuestionId = typeof ReviewQuestionId.Type;

export const InferenceCallId = Schema.String.pipe(Schema.brand("InferenceCallId"));
export type InferenceCallId = typeof InferenceCallId.Type;

/** The run id on the Sealant platform — evidence pointers address recordings through it. */
export const SealantRunId = Schema.String.pipe(Schema.brand("SealantRunId"));
export type SealantRunId = typeof SealantRunId.Type;

export const SealantWorkspaceId = Schema.String.pipe(Schema.brand("SealantWorkspaceId"));
export type SealantWorkspaceId = typeof SealantWorkspaceId.Type;

export const Sha = Schema.String.pipe(Schema.brand("Sha"));
export type Sha = typeof Sha.Type;

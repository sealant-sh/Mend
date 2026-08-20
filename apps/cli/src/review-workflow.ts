export interface ReviewSessionLike {
  readonly id: string;
  readonly harness: string;
}

export interface ReviewAnnotationLike {
  readonly changeId: string | null;
}

export interface FollowUpDeliveryInput {
  readonly reviewSliceId: string;
  readonly checkpointAId: string;
  readonly checkpointBId: string;
  readonly diffDigest: string;
  readonly commentIds: ReadonlyArray<string>;
  readonly instruction: string;
  readonly idempotencyKey: string;
}

export const reviewTargetForSession = <Session extends ReviewSessionLike>(
  session: Session,
  annotation: ReviewAnnotationLike | undefined,
  projectName: string,
): { readonly session: Session; readonly changeId: string; readonly projectName: string } | null =>
  annotation?.changeId === null || annotation?.changeId === undefined
    ? null
    : { session, changeId: annotation.changeId, projectName };

export const commentRange = (
  start: number | null,
  current: number,
): { readonly line: number; readonly endLine: number | null } =>
  start === null
    ? { line: current, endLine: null }
    : { line: Math.min(start, current), endLine: Math.max(start, current) };

export type ReviewApi = (method: "GET" | "POST", route: string, body?: unknown) => Promise<unknown>;

/** One server-owned operation: persist intent, launch, correlate, finalize. */
export const deliverReview = (
  api: ReviewApi,
  sessionId: string,
  input: FollowUpDeliveryInput,
): Promise<unknown> => api("POST", `/sessions/${sessionId}/follow-up/deliver`, input);

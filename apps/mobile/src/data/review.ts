// The review loop's data: comments anchored to the diff (or the change as a
// whole), the composed description/tour, the recorded machine passes, and
// the follow-up bundle. Polling stands in for the web's SSE — passes poll
// fast only while one is running, so a queued pass surfaces quickly and a
// quiet screen stays cheap.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";

import { ApiError, api, requireFollowUpDelivery, type FollowUpDto } from "@/data/live";

// ─── wire types (the server's DTOs, minimally) ──────────────────────────────

/** A finding's link into the session record; sequence is a decimal string. */
export interface RecordLinkDto {
  readonly sealantRunId: string;
  readonly sequence: string;
  readonly excerpt: string;
}

export interface ReviewCommentDto {
  readonly id: string;
  readonly changeId: string;
  readonly file: string | null;
  readonly line: number | null;
  readonly endLine: number | null;
  readonly authorKind: "reviewer" | "mend";
  readonly authorName: string;
  readonly body: string;
  /** `suggestion` carries a concrete replacement for the anchored lines. */
  readonly kind: "note" | "suggestion";
  readonly suggestion: string | null;
  readonly state: "draft" | "open" | "addressed" | "dismissed";
  readonly evidence: ReadonlyArray<RecordLinkDto>;
  readonly sentToSessionId: string | null;
  readonly createdAt: string;
}

/** One stop of the composed review tour. Coordinates are new-file lines. */
export interface TourStopDto {
  readonly title: string;
  readonly file: string | null;
  readonly line: number | null;
  readonly endLine: number | null;
  readonly narration: string;
  readonly evidence: ReadonlyArray<RecordLinkDto>;
  readonly grounded: boolean;
}

export interface ChangeTourDto {
  readonly id: string;
  readonly changeId: string;
  readonly sessionId: string;
  readonly summary: string;
  readonly approach: string | null;
  readonly stops: ReadonlyArray<TourStopDto>;
  readonly diffDigest: string;
  readonly createdAt: string;
}

/**
 * A machine pass's recorded outcome. Zero findings on a completed pass is
 * an outcome, not an absence — "completed · none" and "never ran" must
 * never look the same.
 */
export interface ChangePassDto {
  readonly changeId: string;
  readonly kind: "tour" | "read" | "suggest";
  readonly status: "running" | "completed" | "failed";
  readonly detail: string | null;
  readonly findings: number | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
}

// ─── queries ────────────────────────────────────────────────────────────────

export const useChangeComments = (changeId: string | null) =>
  useQuery({
    queryKey: ["change", changeId, "comments"],
    enabled: changeId !== null,
    queryFn: () => api<ReadonlyArray<ReviewCommentDto>>("GET", `/changes/${changeId}/comments`),
    // Draft findings land asynchronously as passes complete.
    refetchInterval: 10_000,
  });

export const useChangeTour = (changeId: string | null) =>
  useQuery({
    queryKey: ["change", changeId, "tour"],
    enabled: changeId !== null,
    queryFn: () => api<ChangeTourDto | null>("GET", `/changes/${changeId}/tour`),
    // Composed at settle by the automation cascade — it can arrive while
    // the screen is already open.
    refetchInterval: 15_000,
  });

export const useChangePasses = (changeId: string | null) =>
  useQuery({
    queryKey: ["change", changeId, "passes"],
    enabled: changeId !== null,
    queryFn: () => api<ReadonlyArray<ChangePassDto>>("GET", `/changes/${changeId}/passes`),
    refetchInterval: (query) =>
      (query.state.data ?? []).some((pass) => pass.status === "running") ? 2_500 : 12_000,
  });

// ─── actions ────────────────────────────────────────────────────────────────

export interface NewCommentInput {
  readonly file: string | null;
  readonly line: number | null;
  readonly body: string;
}

export const useReviewActions = (changeId: string) => {
  const queryClient = useQueryClient();
  // Prefix key: catches the diff (["change", id]) and every sub-query.
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["change", changeId] });
  const comment = useMutation({
    mutationFn: (input: NewCommentInput) =>
      api<ReviewCommentDto>("POST", `/changes/${changeId}/comments`, input),
    onSettled: invalidate,
  });
  const setState = useMutation({
    mutationFn: (input: {
      readonly commentId: string;
      readonly state: "open" | "addressed" | "dismissed";
    }) =>
      api<ReviewCommentDto>("POST", `/changes/${changeId}/comments/${input.commentId}/state`, {
        state: input.state,
      }),
    onSettled: invalidate,
  });
  // read | suggest | tour — the kind is the route; findings arrive as draft
  // comments (or the tour row) when the queued job completes.
  const queuePass = useMutation({
    mutationFn: (kind: "read" | "suggest" | "tour") =>
      api<{ readonly queued: boolean }>("POST", `/changes/${changeId}/${kind}`, {}),
    onSettled: invalidate,
  });
  return { comment, setState, queuePass };
};

let reviewDeliverySequence = 0;

const nextReviewDeliveryKey = (changeId: string): string => {
  reviewDeliverySequence += 1;
  return `mobile-review:${changeId}:${Date.now().toString(36)}:${reviewDeliverySequence.toString(36)}`;
};

interface OpenReviewResultDto {
  readonly slice: {
    readonly id: string;
    readonly checkpointAId: string;
    readonly checkpointBId: string;
    readonly diffDigest: string;
  };
}

/** Pin the current change, then hand the exact edited instruction to server-owned delivery. */
export const useSendReview = (
  changeId: string,
  sessionId: string,
  commentIds: ReadonlyArray<string>,
  expectedDiffDigest: string,
) => {
  const queryClient = useQueryClient();
  const selectedCommentIds = useRef(commentIds);
  const reviewedDiffDigest = useRef(expectedDiffDigest);
  const idempotencyKey = useRef(nextReviewDeliveryKey(changeId));
  return useMutation({
    mutationFn: async (instruction: string) => {
      const review = await api<OpenReviewResultDto>("POST", `/changes/${changeId}/reviews/open`, {
        idempotencyKey: `open:${idempotencyKey.current}`,
      });
      if (review.slice.diffDigest !== reviewedDiffDigest.current) {
        throw new ApiError(
          "The worktree changed after these comments were written. Reopen Review before sending.",
          0,
        );
      }
      const followUp = await api<FollowUpDto>("POST", `/sessions/${sessionId}/follow-up/deliver`, {
        reviewSliceId: review.slice.id,
        checkpointAId: review.slice.checkpointAId,
        checkpointBId: review.slice.checkpointBId,
        diffDigest: review.slice.diffDigest,
        commentIds: selectedCommentIds.current,
        instruction,
        idempotencyKey: idempotencyKey.current,
      });
      return requireFollowUpDelivery(followUp);
    },
    onSettled: () => queryClient.invalidateQueries(),
  });
};

import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  agentIsLive,
  deliverFollowUp,
  type DeliverFollowUpInput,
  type FollowUpDto,
} from "#/lib/api";
import { queryClient, sessionDetailQuery } from "#/lib/queries";

const retryInput = (followUp: FollowUpDto): DeliverFollowUpInput | null =>
  followUp.reviewSliceId === null ||
  followUp.checkpointAId === null ||
  followUp.checkpointBId === null ||
  followUp.diffDigest === null ||
  followUp.idempotencyKey === null
    ? null
    : {
        reviewSliceId: followUp.reviewSliceId,
        checkpointAId: followUp.checkpointAId,
        checkpointBId: followUp.checkpointBId,
        diffDigest: followUp.diffDigest,
        commentIds: followUp.commentIds,
        instruction: followUp.instruction,
        idempotencyKey: followUp.idempotencyKey,
      };

/** Recoverable delivery state for the one server-owned Review operation. */
export function FollowUpBanner({
  sessionId,
  followUp,
}: {
  readonly sessionId: string;
  readonly followUp: FollowUpDto | null;
}) {
  const { session, currentAgent } = useSuspenseQuery(sessionDetailQuery(sessionId)).data;
  const [delivering, setDelivering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (followUp === null) return null;

  const input = retryInput(followUp);
  // A follow-up needs the AGENT gone, not the workspace: shells holding it leave the session
  // `idle`, and the next agent process joins them there.
  const active = agentIsLive(session, currentAgent);
  const deliver = () => {
    if (input === null || delivering || (active && followUp.status !== "delivering")) return;
    setDelivering(true);
    setError(null);
    void deliverFollowUp(sessionId, input)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        void queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
        void queryClient.invalidateQueries({ queryKey: ["change", followUp.changeId] });
        setDelivering(false);
      });
  };

  const status =
    followUp.status === "delivering"
      ? "delivery in progress"
      : followUp.status === "delivery_failed"
        ? "delivery failed · retryable"
        : "follow-up pending";

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <p className="font-mono text-xs text-warning">{status}</p>
      {input === null ? (
        <p className="font-mono text-xs text-faint">
          legacy bundle · recreate it from a pinned Review before delivery
        </p>
      ) : active && followUp.status !== "delivering" ? (
        <p className="font-mono text-xs text-faint">
          the session is live — this bundle remains pending
        </p>
      ) : (
        <button
          type="button"
          disabled={delivering}
          onClick={deliver}
          className="rounded-xl bg-primary px-3 py-1.5 font-sans text-xs font-medium text-primary-foreground shadow-[var(--shadow-cobalt)] transition-transform hover:-translate-y-0.5 disabled:opacity-50"
        >
          {delivering
            ? "Checking…"
            : followUp.status === "delivering"
              ? "Check delivery"
              : followUp.status === "delivery_failed"
                ? "Retry delivery"
                : "Deliver"}
        </button>
      )}
      {followUp.deliveryError !== null && (
        <p className="font-mono text-xs text-warning">{followUp.deliveryError}</p>
      )}
      {error !== null && <p className="font-mono text-xs text-warning">{error}</p>}
    </div>
  );
}

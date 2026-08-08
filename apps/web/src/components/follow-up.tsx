import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { FollowUpDto } from "#/lib/api";
import { continueArgv, deliverFollowUp, launchSession } from "#/lib/api";
import { queryClient, sessionDetailQuery } from "#/lib/queries";

const ACTIVE = new Set(["starting", "running", "waiting", "idle"]);

/**
 * The second half of the review loop, in the browser — `mend continue`
 * parity over the same endpoints the CLI drives: deliver the pending
 * follow-up (which reopens the session), then relaunch the harness in the
 * same worktree with the instruction as its opening prompt. No terminal
 * required to close the loop.
 */
export function FollowUpBanner({
  sessionId,
  followUp,
}: {
  readonly sessionId: string;
  readonly followUp: FollowUpDto | null;
}) {
  const { session } = useSuspenseQuery(sessionDetailQuery(sessionId)).data;
  const [delivering, setDelivering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (followUp === null) return null;

  const argv = continueArgv(session.harness, followUp.instruction);
  const active = ACTIVE.has(session.status);

  const deliver = () => {
    if (argv === null || delivering) return;
    setDelivering(true);
    setError(null);
    void deliverFollowUp(sessionId)
      .then(() => launchSession(sessionId, argv))
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        // Prefix key: refreshes the session detail AND the follow-up query.
        void queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
        setDelivering(false);
      });
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <p className="font-mono text-xs text-warning">follow-up pending</p>
      {active ? (
        <p className="font-mono text-xs text-faint">
          the session is live — deliver once it settles
        </p>
      ) : argv === null ? (
        <p className="font-mono text-xs text-faint">
          harness “{session.harness}” has no known resume command — run it in the worktree; the
          follow-up stays pending
        </p>
      ) : (
        <button
          type="button"
          disabled={delivering}
          onClick={deliver}
          className="rounded-xl bg-primary px-3 py-1.5 font-sans text-xs font-medium text-primary-foreground shadow-[var(--shadow-cobalt)] transition-transform hover:-translate-y-0.5 disabled:opacity-50"
        >
          {delivering ? "Delivering — provisioning the workspace…" : "Deliver & relaunch"}
        </button>
      )}
      {error !== null && <p className="font-mono text-xs text-warning">{error}</p>}
    </div>
  );
}

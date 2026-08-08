import { useState } from "react";

import type { ReviewCommentDto } from "#/lib/api";
import { setCommentState } from "#/lib/api";
import { queryClient } from "#/lib/queries";

/**
 * The reviewer's disposition on a comment: open comments can be marked
 * addressed or dismissed; either can be reopened. State words, not verdicts —
 * and only open unsent comments join the next follow-up bundle, so dismissing
 * a comment also drops it from what the session is asked to do.
 */
export function CommentStateActions({ comment }: { readonly comment: ReviewCommentDto }) {
  const [pending, setPending] = useState<string | null>(null);
  // A comment sent to the session settles through the follow-up loop; a
  // machine draft settles through accept/dismiss. Hand-flipping either here
  // would misstate what happened.
  if (comment.sentToSessionId !== null || comment.state === "draft") return null;

  const act = (state: "open" | "addressed" | "dismissed") => {
    setPending(state);
    void setCommentState(comment.changeId, comment.id, state)
      .then(() => queryClient.invalidateQueries({ queryKey: ["change", comment.changeId] }))
      .finally(() => setPending(null));
  };
  const actions =
    comment.state === "open"
      ? ([
          { state: "addressed", label: "Mark addressed" },
          { state: "dismissed", label: "Dismiss" },
        ] as const)
      : ([{ state: "open", label: "Reopen" }] as const);

  return (
    <div className="mt-2 flex items-center gap-3">
      {actions.map(({ state, label }) => (
        <button
          key={state}
          type="button"
          disabled={pending !== null}
          onClick={() => act(state)}
          className="font-mono text-[10.5px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          {pending === state ? "…" : label}
        </button>
      ))}
    </div>
  );
}

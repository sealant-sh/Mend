import { useState } from "react";

import type { ReviewCommentDto } from "#/lib/api";
import { setCommentState } from "#/lib/api";
import { queryClient } from "#/lib/queries";

/**
 * The reviewer's disposition on a comment: open comments can be marked
 * addressed or dismissed; either can be reopened. Mend's draft findings are
 * accepted (they become open comments and join the next follow-up bundle
 * like any reviewer comment) or dismissed. State words, not verdicts.
 */
export function CommentStateActions({ comment }: { readonly comment: ReviewCommentDto }) {
  const [pending, setPending] = useState<string | null>(null);
  // A comment sent to the session settles through the follow-up loop.
  if (comment.sentToSessionId !== null) return null;

  const act = (state: "open" | "addressed" | "dismissed") => {
    setPending(state);
    void setCommentState(comment.changeId, comment.id, state)
      .then(() => queryClient.invalidateQueries({ queryKey: ["change", comment.changeId] }))
      .finally(() => setPending(null));
  };
  const actions =
    comment.state === "draft"
      ? ([
          { state: "open", label: "Accept" },
          { state: "dismissed", label: "Dismiss" },
        ] as const)
      : comment.state === "open"
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

/**
 * The finding's links into the session record — the reason it was allowed to
 * exist. Sequences address the platform record; excerpts are what was there.
 */
export function EvidenceLines({ comment }: { readonly comment: ReviewCommentDto }) {
  if (comment.evidence.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-1">
      {comment.evidence.map((link, index) => (
        <p key={index} className="truncate font-mono text-[10.5px] text-faint">
          seq {link.sequence} · <span className="text-ink-2">{link.excerpt}</span>
        </p>
      ))}
    </div>
  );
}

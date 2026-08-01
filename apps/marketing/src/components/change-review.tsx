// The Change Review — the product's centerpiece exhibit: a session's worktree
// against its base, mid-review. A real diff with edge-marks, an inline human
// comment, a draft finding from "Mend read this change" (evidence-linked,
// never a verdict), and the saved follow-up that closes the current loop.
//
// Static-first and illustrative; every value is a machine fact in mono.

import { type ReactNode } from "react";

function DiffLine({ sign, children }: { sign: "+" | "-" | " "; children: ReactNode }) {
  const edge =
    sign === "+"
      ? "border-l-2 border-[var(--sw-add-edge)] bg-[var(--sw-add-bg)]"
      : sign === "-"
        ? "border-l-2 border-[var(--sw-del-edge)] bg-[var(--sw-del-bg)]"
        : "border-l-2 border-transparent";
  return (
    <pre className={`overflow-x-auto py-[0.15rem] pl-2.5 font-mono text-xs ${edge}`}>
      <code className="text-ink-2">
        <span className="select-none text-faint">{sign} </span>
        {children}
      </code>
    </pre>
  );
}

// An inline comment card, anchored under a diff line. The cobalt edge marks
// the human's draft; the machine draft carries its evidence line instead.
function CommentCard({
  author,
  meta,
  children,
  evidence,
  actions = false,
}: {
  author: string;
  meta: string;
  children: ReactNode;
  evidence?: string;
  actions?: boolean;
}) {
  return (
    <div className="my-2 ml-6 max-w-[36rem] rounded-xl border border-rule bg-panel px-4 py-3 shadow-[var(--shadow-xs)]">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[0.78rem] font-medium text-foreground">{author}</span>
        <span className="font-mono text-[0.64rem] text-faint">{meta}</span>
      </p>
      <p className="mt-1 text-[0.82rem] leading-relaxed text-foreground">{children}</p>
      {evidence ? (
        <p className="mt-2 font-mono text-[0.66rem] text-muted-foreground">{evidence}</p>
      ) : null}
      {actions ? (
        <p className="mt-2 flex gap-4 font-mono text-[0.68rem]">
          <span className="text-primary">Accept</span>
          <span className="text-primary">Edit</span>
          <span className="text-faint">Dismiss</span>
        </p>
      ) : null}
    </div>
  );
}

export function ChangeReview({
  illustrative = false,
  className = "",
}: {
  readonly illustrative?: boolean;
  readonly className?: string;
}) {
  return (
    <figure className={`min-w-0 ${className}`}>
      <div className="overflow-hidden rounded-2xl border border-border bg-panel shadow-[var(--shadow-md)]">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-rule bg-[var(--sw-sunken)] px-5 py-3 sm:px-7">
          <span className="min-w-0 truncate font-mono text-[0.72rem] text-ink-2">
            billing-service <span className="text-faint">/</span> change{" "}
            <span className="text-primary">01J8QK4M</span>{" "}
            <span className="text-faint">· worktree vs base · no commit yet</span>
          </span>
          <span className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[0.68rem]">
            <span className="text-muted-foreground">session claude · 4 files · +86 / −12</span>
            <span className="hidden text-primary sm:inline">Record · 212 events</span>
          </span>
        </div>

        <div className="bg-[var(--sw-sunken)] px-5 py-1.5 font-mono text-[0.68rem] text-faint sm:px-7">
          src/invoice.ts
        </div>
        <div className="px-5 py-3 sm:px-7">
          <DiffLine sign=" ">const discounted = subtotal - discount(subtotal);</DiffLine>
          <DiffLine sign="-">return round(subtotal) - discount(subtotal);</DiffLine>
          <DiffLine sign="+">return round(discounted);</DiffLine>
          <CommentCard author="You" meta="draft · line 42">
            Half-cent capture path — is round-half-even applied here too?
          </CommentCard>
          <DiffLine sign=" ">{"}"}</DiffLine>
          <CommentCard
            author="Mend read this change"
            meta="planned draft · not a verdict"
            evidence="evidence: seq 0087–0198 · proposed check: pnpm test invoice-rounding"
            actions
          >
            <code className="font-mono text-[0.9em]">round()</code> was rewritten, but no test
            exercising the half-cent path ran in this session.
          </CommentCard>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule px-5 py-3.5 sm:px-7">
          <span className="font-mono text-[0.7rem] text-muted-foreground">
            1 comment open · assembled into one editable follow-up
          </span>
          <span className="inline-flex min-h-9 items-center justify-center rounded-xl bg-primary px-4 font-sans text-[0.8rem] font-medium text-primary-foreground shadow-[var(--shadow-cobalt)]">
            Save follow-up for session
          </span>
        </div>
      </div>
      {illustrative ? (
        <figcaption className="mt-3 text-center font-mono text-[0.62rem] tracking-[0.04em] text-faint uppercase">
          Illustrative review — Mend is in development
        </figcaption>
      ) : null}
    </figure>
  );
}

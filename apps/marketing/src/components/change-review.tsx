// The Change Review — the product's centerpiece exhibit: a session's worktree
// against its base, mid-review, shaped like a real review tool. A file rail
// with per-file counts, one open file with numbered hunks, one human comment
// thread anchored to its line, and the machine finding as a quiet planned
// strip (evidence-linked, never a verdict).
//
// Static-first and illustrative; every value is a machine fact in mono.

import { type ReactNode } from "react";

import { MendMark } from "#/components/logo";

interface FileRow {
  readonly name: string;
  readonly add: number;
  readonly del: number;
  readonly state?: "viewed" | "active";
}

const FILES: ReadonlyArray<FileRow> = [
  { name: "src/types.ts", add: 4, del: 0, state: "viewed" },
  { name: "src/invoice.ts", add: 22, del: 4, state: "active" },
  { name: "src/round.ts", add: 9, del: 1 },
  { name: "src/invoice.test.ts", add: 51, del: 7 },
];

interface DiffRow {
  readonly oldNo?: number;
  readonly newNo?: number;
  readonly sign: " " | "+" | "-";
  readonly text: string;
}

const HUNK_1: ReadonlyArray<DiffRow> = [
  { oldNo: 38, newNo: 38, sign: " ", text: "const subtotal = sumLines(invoice.lines);" },
  { oldNo: 39, newNo: 39, sign: " ", text: "const discounted = subtotal - discount(subtotal);" },
  { oldNo: 40, sign: "-", text: "return round(subtotal) - discount(subtotal);" },
  { newNo: 40, sign: "+", text: "return round(discounted);" },
];

const HUNK_2: ReadonlyArray<DiffRow> = [
  { oldNo: 52, newNo: 53, sign: " ", text: "export function round(amount: number) {" },
  { oldNo: 53, sign: "-", text: "return Math.round(amount * 100) / 100;" },
  { newNo: 54, sign: "+", text: "return roundHalfEven(amount * 100) / 100;" },
];

function HunkHeader({ children }: { children: ReactNode }) {
  return (
    <p className="my-1 overflow-x-auto bg-[var(--sw-sunken)] px-2.5 py-1 font-mono text-[0.66rem] whitespace-nowrap text-faint">
      {children}
    </p>
  );
}

function DiffLine({ oldNo, newNo, sign, text }: DiffRow) {
  const edge =
    sign === "+"
      ? "border-l-2 border-[var(--sw-add-edge)] bg-[var(--sw-add-bg)]"
      : sign === "-"
        ? "border-l-2 border-[var(--sw-del-edge)] bg-[var(--sw-del-bg)]"
        : "border-l-2 border-transparent";
  return (
    <div className={`grid grid-cols-[2rem_2rem_1fr] font-mono text-xs ${edge}`}>
      <span className="py-[0.15rem] pr-1.5 text-right text-faint select-none">{oldNo ?? ""}</span>
      <span className="py-[0.15rem] pr-2 text-right text-faint select-none">{newNo ?? ""}</span>
      <pre className="overflow-x-auto py-[0.15rem]">
        <code className="text-ink-2">
          <span className="text-faint select-none">{sign} </span>
          {text}
        </code>
      </pre>
    </div>
  );
}

// A comment thread anchored under its diff line. The machine reviewer's
// draft carries evidence, an optional committable suggestion, and actions —
// a draft to accept or dismiss, never a verdict.
function CommentCard({
  author,
  meta,
  children,
  mark = false,
  evidence,
  suggestion,
  actions = false,
}: {
  author: string;
  meta: string;
  children: ReactNode;
  mark?: boolean;
  evidence?: string;
  suggestion?: { readonly file: string; readonly lines: ReadonlyArray<string> };
  actions?: boolean;
}) {
  return (
    <div className="my-2 ml-6 max-w-[34rem] rounded-xl border border-rule bg-panel px-4 py-3 shadow-[var(--shadow-xs)] sm:ml-[4.5rem]">
      <p className="flex flex-wrap items-center gap-x-2">
        {mark ? <MendMark className="size-4" aria-hidden="true" /> : null}
        <span className="text-[0.78rem] font-medium text-foreground">{author}</span>
        <span className="font-mono text-[0.64rem] text-faint">{meta}</span>
      </p>
      <p className="mt-1 text-[0.82rem] leading-relaxed text-foreground">{children}</p>
      {suggestion ? (
        <div className="mt-2.5 overflow-hidden rounded-lg border border-rule">
          <p className="border-b border-rule-faint bg-[var(--sw-sunken)] px-3 py-1.5 font-mono text-[0.64rem] text-faint">
            suggested addition · {suggestion.file}
          </p>
          {suggestion.lines.map((line) => (
            <pre
              key={line}
              className="overflow-x-auto border-l-2 border-[var(--sw-add-edge)] bg-[var(--sw-add-bg)] py-[0.15rem] pl-2.5 font-mono text-xs"
            >
              <code className="text-ink-2">
                <span className="text-faint select-none">+ </span>
                {line}
              </code>
            </pre>
          ))}
        </div>
      ) : null}
      {evidence ? (
        <p className="mt-2 font-mono text-[0.66rem] text-muted-foreground">{evidence}</p>
      ) : null}
      {actions ? (
        <p className="mt-2.5 flex gap-4 font-mono text-[0.68rem]">
          <span className="text-primary">Accept suggestion</span>
          <span className="text-primary">Edit</span>
          <span className="text-faint">Dismiss</span>
        </p>
      ) : null}
    </div>
  );
}

function FileRail() {
  return (
    <nav className="hidden border-r border-rule sm:block" aria-label="Changed files">
      <p className="ev-eyebrow border-b border-rule-faint px-4 py-2 text-faint">4 files changed</p>
      <ul>
        {FILES.map(({ name, add, del, state }) => (
          <li
            key={name}
            className={`flex items-baseline justify-between gap-2 border-b border-rule-faint px-4 py-2 font-mono text-[0.7rem] last:border-b-0 ${
              state === "active"
                ? "border-l-2 border-l-primary bg-[var(--sw-sunken)] text-foreground"
                : "border-l-2 border-l-transparent text-muted-foreground"
            }`}
          >
            <span className="min-w-0 truncate">
              {state === "viewed" ? <span className="text-success">✓ </span> : null}
              {name}
            </span>
            <span className="shrink-0 text-[0.66rem]">
              <span className="text-success">+{add}</span>
              {del > 0 ? <span className="text-[var(--sw-del-edge)]"> −{del}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </nav>
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
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-rule bg-[var(--sw-sunken)] px-5 py-3 sm:px-6">
          <span className="min-w-0 truncate font-mono text-[0.72rem] text-ink-2">
            billing-service <span className="text-faint">/</span> change{" "}
            <span className="text-primary">01J8QK4M</span>{" "}
            <span className="text-faint">· worktree vs base · no commit yet</span>
          </span>
          <span className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[0.68rem]">
            <span className="text-muted-foreground">session claude · +86 / −12</span>
            <span className="hidden text-primary sm:inline">Record · 212 events</span>
          </span>
        </div>

        <div className="grid sm:grid-cols-[13rem_1fr]">
          <FileRail />
          <div className="min-w-0">
            <p className="border-b border-rule-faint px-4 py-2 font-mono text-[0.7rem] text-ink-2">
              src/invoice.ts{" "}
              <span className="text-[0.66rem]">
                <span className="text-success">+22</span>{" "}
                <span className="text-[var(--sw-del-edge)]">−4</span>
              </span>
            </p>
            <div className="px-1.5 py-2 sm:px-2.5">
              <HunkHeader>{"@@ -38,7 +38,8 @@ export function totalWithDiscount"}</HunkHeader>
              {HUNK_1.map((row) => (
                <DiffLine key={`${row.sign}${row.oldNo ?? ""}-${row.newNo ?? ""}`} {...row} />
              ))}
              <CommentCard author="You" meta="draft · src/invoice.ts:40">
                Half-cent capture path — is round-half-even applied here too?
              </CommentCard>
              <HunkHeader>{"@@ -52,3 +53,3 @@ export function round"}</HunkHeader>
              {HUNK_2.map((row) => (
                <DiffLine key={`${row.sign}${row.oldNo ?? ""}-${row.newNo ?? ""}`} {...row} />
              ))}
              <CommentCard
                author="Mend"
                meta="draft · from the session record"
                mark
                evidence="evidence: seq 0087–0198 · proposed check: pnpm test invoice-rounding"
                suggestion={{
                  file: "src/invoice.test.ts",
                  lines: ["expect(round(2.005)).toBe(2.0);", "expect(round(2.015)).toBe(2.02);"],
                }}
                actions
              >
                <code className="font-mono text-[0.9em]">round()</code> now rounds half-even, but
                nothing in this session exercised a half-cent amount.
              </CommentCard>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule px-5 py-3.5 sm:px-6">
          <span className="font-mono text-[0.7rem] text-muted-foreground">
            2 comments open · assembled into one editable follow-up
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

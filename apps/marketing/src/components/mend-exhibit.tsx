// The Mend Exhibit — the hero artifact. The whole loop as one reviewable
// object, top to bottom: the issue that came in, the run that mended it, and
// the pull request that came out with its evidence attached. Built from the
// evidence-review vocabulary (dot+word status, mono machine facts, hairline
// rows, warm panels). Static-first and illustrative.

import { GitPullRequestArrow, type LucideIcon, MessageSquareText } from "lucide-react";
import { type ReactNode } from "react";

import { DiffPeek } from "#/components/run-record";

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-xl border border-rule bg-panel ${className}`}>
      {children}
    </div>
  );
}

function PanelHead({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-rule px-3.5 py-2.5">
      {children}
    </div>
  );
}

function Status({
  word,
  dot = "bg-success-dot",
  text = "text-success",
}: {
  word: string;
  dot?: string;
  text?: string;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <span className={`size-1.5 rounded-full ${dot}`} aria-hidden="true" />
      <span className={`font-mono text-[0.7rem] ${text}`}>{word}</span>
    </span>
  );
}

function Kv({ rows }: { rows: ReadonlyArray<readonly [string, ReactNode]> }) {
  return (
    <dl>
      {rows.map(([k, v]) => (
        <div
          key={k}
          className="grid grid-cols-[5.5rem_1fr] gap-x-3 border-b border-rule-faint px-3.5 py-2 last:border-b-0"
        >
          <dt className="ev-eyebrow text-faint">{k}</dt>
          <dd className="min-w-0 truncate font-mono text-[0.72rem] text-ink-2">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ── Stage 1 — the issue in ───────────────────────────────────────────────────
function UiIssue() {
  return (
    <Panel>
      <PanelHead>
        <span className="flex min-w-0 items-center gap-2">
          <MessageSquareText className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
          <span className="truncate font-mono text-[0.72rem] text-ink-2">
            acme/billing-service #214
          </span>
        </span>
        <Status
          word="Queued"
          dot="bg-transparent ring-[1.5px] ring-[#b3b0a8]"
          text="text-muted-foreground"
        />
      </PanelHead>
      <div className="px-3.5 py-3">
        <p className="text-sm leading-snug font-medium text-foreground">
          Invoice totals drift by a cent on discounted orders
        </p>
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          Rounding is applied before the discount, so a $19.99 order with 15% off bills $16.99
          instead of $17.00. Repro in the checkout integration tests.
        </p>
      </div>
      <Kv
        rows={[
          ["Labels", "bug · mend"],
          ["Branch", "main @ a9f3c20"],
        ]}
      />
    </Panel>
  );
}

// ── Stage 2 — the mending run ────────────────────────────────────────────────
const RUN_EVENTS: ReadonlyArray<{ offset: string; name: string; detail: string }> = [
  { offset: "00:00.000", name: "sandbox.ready", detail: "node 20 · ubuntu 24.04" },
  { offset: "00:19.310", name: "process.exited", detail: "pnpm test · exit 1 · reproduced" },
  { offset: "00:26.882", name: "file.modified", detail: "src/invoice.ts" },
  { offset: "00:33.415", name: "process.exited", detail: "pnpm test · exit 0 · 14 passed" },
];

function UiRun() {
  return (
    <Panel>
      <PanelHead>
        <span className="flex min-w-0 items-center gap-2">
          <span
            className="mend-status-running size-2 shrink-0 rounded-full bg-primary"
            aria-hidden="true"
          />
          <span className="truncate font-mono text-[0.72rem] text-ink-2">run mnd_4c7t</span>
        </span>
        <Status word="Completed · observed" />
      </PanelHead>
      <div>
        {RUN_EVENTS.map((e) => (
          <div
            key={e.offset}
            className="flex flex-wrap items-baseline gap-x-2.5 border-b border-rule-faint px-3.5 py-1.5 font-mono text-[0.7rem] last:border-b-0"
          >
            <span className="text-faint tabular-nums">{e.offset}</span>
            <span className="text-ink-2">{e.name}</span>
            {e.detail ? <span className="text-muted-foreground">{e.detail}</span> : null}
          </div>
        ))}
        <div className="border-t border-rule-faint px-3.5 py-1.5 font-mono text-[0.66rem] text-faint">
          + 208 more events · full record kept
        </div>
      </div>
    </Panel>
  );
}

// ── Stage 3 — the reviewed change out ────────────────────────────────────────
function UiPullRequest() {
  return (
    <Panel>
      <PanelHead>
        <span className="flex min-w-0 items-center gap-2">
          <GitPullRequestArrow className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span className="truncate font-mono text-[0.72rem] text-ink-2">
            #221 · mend/invoice-rounding → main
          </span>
        </span>
        <Status word="PR opened · observed" />
      </PanelHead>
      <Kv
        rows={[
          ["Changes", "2 files · +9 / −6"],
          ["Checks", "pnpm test · 14 passed · observed"],
          ["Record", "run mnd_4c7t · 212 events · replayable"],
        ]}
      />
      <DiffPeek
        file="src/invoice.ts"
        lines={[
          { sign: " ", text: "const discounted = subtotal - discount(subtotal);" },
          { sign: "-", text: "return round(subtotal) - discount(subtotal);" },
          { sign: "+", text: "return round(discounted);" },
        ]}
      />
    </Panel>
  );
}

// ── Stage scaffold (the rail + dot) ──────────────────────────────────────────
function Stage({
  title,
  tag,
  icon: Icon,
  ui,
  last = false,
}: {
  title: string;
  tag: string;
  icon?: LucideIcon;
  ui: ReactNode;
  last?: boolean;
}) {
  return (
    <div className="flex gap-4 sm:gap-5">
      <div className="flex flex-col items-center pt-1.5">
        <span
          className="size-3 shrink-0 rounded-full bg-primary ring-4 ring-[var(--sw-wash)]"
          aria-hidden="true"
        />
        {last ? null : <span className="mt-1.5 w-px flex-1 bg-rule" aria-hidden="true" />}
      </div>
      <div className={`min-w-0 flex-1 ${last ? "" : "pb-8"}`}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="font-display text-base font-semibold tracking-[-0.01em] text-foreground">
            {Icon ? (
              <Icon className="mr-1.5 -mt-0.5 inline size-4 text-faint" aria-hidden="true" />
            ) : null}
            {title}
          </h3>
          <span className="ev-eyebrow text-faint normal-case">{tag}</span>
        </div>
        <div className="mt-3">{ui}</div>
      </div>
    </div>
  );
}

export function MendExhibit({
  illustrative = false,
  lift = false,
  className = "",
}: {
  readonly illustrative?: boolean;
  readonly lift?: boolean;
  readonly className?: string;
}) {
  const shadow = lift ? "shadow-[var(--shadow-cobalt)]" : "shadow-[var(--shadow-md)]";
  return (
    <figure className={`min-w-0 ${className}`}>
      <div className={`overflow-hidden rounded-2xl border border-border bg-panel ${shadow}`}>
        <div className="flex items-center justify-between gap-3 border-b border-rule px-5 py-3.5">
          <span className="ev-eyebrow text-faint">Mended change</span>
          <span className="font-mono text-xs text-faint">
            acme/billing-service · issue #214 → PR #221
          </span>
        </div>
        <div className="px-5 py-7 sm:px-7">
          <Stage title="The issue comes in" tag="issue.opened" ui={<UiIssue />} />
          <Stage title="A harness mends it in a sandbox" tag="harness.start" ui={<UiRun />} />
          <Stage
            title="The pull request comes out — with its evidence"
            tag="pull_request.opened"
            ui={<UiPullRequest />}
            last
          />
        </div>
      </div>
      {illustrative ? (
        <figcaption className="mt-3 text-center font-mono text-[0.62rem] tracking-[0.04em] text-faint uppercase">
          Illustrative mended change — Mend is being built in the open
        </figcaption>
      ) : null}
    </figure>
  );
}

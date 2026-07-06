// The Brief — the product's centerpiece exhibit: the review Mend already did,
// compiled from the recording. Rebuilt from the canonical product mock in the
// evidence-review token vocabulary. Two variants: "full" (with the attention
// rail and footer) and "compact" (main column only, for the hero).
//
// Static-first and illustrative; every value is a machine fact in mono.

import { type ReactNode } from "react";

type Disposition = "evidence" | "not-run" | "unrelated";

const DISPOSITION: Record<Disposition, { word: string; dot: string; text: string }> = {
  evidence: { word: "Direct evidence", dot: "bg-[var(--sw-green-dot)]", text: "text-success" },
  "not-run": { word: "Not executed", dot: "bg-[var(--sw-amber)]", text: "text-warning" },
  unrelated: { word: "Unrelated change", dot: "bg-[var(--sw-red)]", text: "text-danger" },
};

const QUESTIONS: ReadonlyArray<{ n: string; label: string; disposition: Disposition }> = [
  { n: "01", label: "Reported discrepancy", disposition: "evidence" },
  { n: "02", label: "Unaffected orders", disposition: "evidence" },
  { n: "03", label: "Currency rounding", disposition: "not-run" },
  { n: "04", label: "Unrelated edit", disposition: "unrelated" },
];

const EVIDENCE_USED: ReadonlyArray<readonly [string, string]> = [
  ["Stripe currency documentation", "Established USD, JPY, and BHD minor-unit scales."],
  ["Payment-provider rounding specification", "Established round-half-even behavior."],
  ["Issue #5187 and reported order", "Provided the failing reproduction."],
  ["Baseline order snapshot", "Used to check unaffected invoices."],
];

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-[0.78rem] font-medium text-label">{children}</p>;
}

function HeaderChip({ children, dot }: { children: ReactNode; dot?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[0.68rem] text-muted-foreground">
      {dot ? <span className={`size-1.5 rounded-full ${dot}`} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

function MainColumn() {
  return (
    <div className="min-w-0 flex-1 px-5 py-5 sm:px-7 sm:py-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="font-mono text-[0.68rem] text-faint">
            <span className="text-primary">#5204</span> · a9f3c20
          </p>
          <h3 className="mt-1.5 max-w-[30ch] font-display text-lg leading-snug font-semibold tracking-[-0.01em] text-foreground sm:text-xl">
            Round invoice totals once, after applying the discount
          </h3>
        </div>
        <div className="shrink-0 text-right">
          <p className="flex items-center justify-end gap-1.5">
            <span className="size-1.5 rounded-full bg-[var(--sw-green-dot)]" aria-hidden="true" />
            <span className="text-[0.8rem] font-medium text-success">
              Reported reproduction passes on head
            </span>
          </p>
          <p className="mt-1 font-mono text-[0.68rem] text-faint">
            base fails · head passes · revert fails
          </p>
        </div>
      </div>

      <div className="mt-6 space-y-5 border-t border-rule pt-5">
        <div>
          <SectionLabel>The issue</SectionLabel>
          <p className="mt-1.5 text-[0.86rem] leading-relaxed text-foreground">
            <span className="font-mono text-[0.8rem] text-primary">#5187</span> — the invoice total
            could differ from the captured charge by one cent.
          </p>
          <p className="mt-1 font-mono text-[0.72rem] text-muted-foreground">
            3 × $19.99 · 15% order discount → preview $50.98 vs captured $50.97
          </p>
        </div>
        <div>
          <SectionLabel>What was done</SectionLabel>
          <p className="mt-1.5 max-w-[58ch] text-[0.86rem] leading-relaxed text-foreground">
            Computed the discount on the subtotal and rounded the total once, using each currency's
            minor-unit scale and the provider's round-half-even rule.
          </p>
          <p className="mt-1 font-mono text-[0.72rem] text-muted-foreground">
            3 files · +41 / −22 · no API, schema, dependency, or provider-contract changes
          </p>
        </div>
        <div>
          <SectionLabel>Status now</SectionLabel>
          <p className="mt-1.5 max-w-[58ch] text-[0.86rem] leading-relaxed text-foreground">
            On head, the reported order reconciles: preview{" "}
            <span className="font-mono text-[0.8rem]">$50.97</span> matches captured{" "}
            <span className="font-mono text-[0.8rem]">$50.97</span> — previously{" "}
            <span className="font-mono text-[0.8rem]">$50.98</span>.
          </p>
        </div>
      </div>

      <div className="mt-6 border-t border-rule pt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <SectionLabel>Review questions</SectionLabel>
          <p className="font-mono text-[0.66rem] text-faint">
            2 directly observed · 1 scenario not run · 1 unrelated edit
          </p>
        </div>
        <div className="mt-2.5">
          {QUESTIONS.map((q) => {
            const d = DISPOSITION[q.disposition];
            return (
              <div
                key={q.n}
                className="flex items-baseline justify-between gap-3 border-b border-rule-faint py-2.5 last:border-b-0"
              >
                <span className="flex min-w-0 items-baseline gap-3">
                  <span className="font-mono text-[0.68rem] text-faint">{q.n}</span>
                  <span className="text-[0.86rem] font-medium text-foreground">{q.label}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className={`size-1.5 rounded-full ${d.dot}`} aria-hidden="true" />
                  <span className={`font-mono text-[0.72rem] ${d.text}`}>{d.word}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AttentionRail() {
  return (
    <aside className="w-full shrink-0 border-t border-rule px-5 py-5 lg:w-[19rem] lg:border-t-0 lg:border-l sm:px-6 sm:py-6">
      <SectionLabel>What needs attention</SectionLabel>
      <div className="mt-2.5 space-y-2.5">
        <p className="border-l-2 border-[var(--sw-amber)] pl-3 text-[0.82rem] leading-snug text-foreground">
          Exact half-cent scenario was not run.
        </p>
        <p className="border-l-2 border-[var(--sw-red)] pl-3 text-[0.82rem] leading-snug text-foreground">
          One edit is unrelated to issue #5187.
        </p>
      </div>

      <div className="mt-6 border-t border-rule-faint pt-5">
        <SectionLabel>Evidence used</SectionLabel>
        <div className="mt-2.5 space-y-3">
          {EVIDENCE_USED.map(([title, took]) => (
            <div key={title}>
              <p className="text-[0.8rem] leading-snug font-medium text-foreground">{title}</p>
              <p className="mt-0.5 text-[0.74rem] leading-snug text-muted-foreground">{took}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 font-mono text-[0.66rem] text-faint">
          8 sources · 3 relied on · 2 external repositories
        </p>
        <p className="mt-1.5 font-mono text-[0.72rem] text-primary">View source trail</p>
      </div>

      <div className="mt-6 border-t border-rule-faint pt-5">
        <SectionLabel>Your review</SectionLabel>
        <p className="mt-2 flex items-center gap-1.5">
          <span
            className="size-1.5 rounded-full bg-transparent ring-[1.5px] ring-[#b3b0a8]"
            aria-hidden="true"
          />
          <span className="font-mono text-[0.72rem] text-muted-foreground">Not started</span>
        </p>
      </div>
    </aside>
  );
}

export function Brief({
  variant = "full",
  lift = false,
  illustrative = false,
  className = "",
}: {
  readonly variant?: "full" | "compact";
  readonly lift?: boolean;
  readonly illustrative?: boolean;
  readonly className?: string;
}) {
  const shadow = lift ? "shadow-[var(--shadow-cobalt)]" : "shadow-[var(--shadow-md)]";
  return (
    <figure className={`min-w-0 ${className}`}>
      <div className={`overflow-hidden rounded-2xl border border-border bg-panel ${shadow}`}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-rule bg-[var(--sw-sunken)] px-5 py-3 sm:px-7">
          <span className="min-w-0 truncate font-mono text-[0.72rem] text-ink-2">
            acme/billing-service <span className="text-faint">/</span>{" "}
            <span className="text-primary">#5204</span>{" "}
            <span className="text-faint">· issue #5187</span>
          </span>
          <span className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1">
            <HeaderChip dot="bg-[var(--sw-green-dot)]">Checks 5</HeaderChip>
            <HeaderChip dot="bg-primary">Evidence current</HeaderChip>
            <span className="hidden font-mono text-[0.68rem] text-primary sm:inline">
              Full diff
            </span>
            <span className="hidden font-mono text-[0.68rem] text-primary sm:inline">
              Run audit
            </span>
          </span>
        </div>

        <div className="flex flex-col lg:flex-row">
          <MainColumn />
          {variant === "full" ? <AttentionRail /> : null}
        </div>

        {variant === "full" ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule px-5 py-3.5 sm:px-7">
            <span className="font-mono text-[0.7rem] text-muted-foreground">
              4 review questions · 2 have direct evidence · 2 need judgment
            </span>
            <span className="inline-flex min-h-9 items-center justify-center rounded-xl bg-primary px-4 font-sans text-[0.8rem] font-medium text-primary-foreground shadow-[var(--shadow-cobalt)]">
              Review change
            </span>
          </div>
        ) : null}
      </div>
      {illustrative ? (
        <figcaption className="mt-3 text-center font-mono text-[0.62rem] tracking-[0.04em] text-faint uppercase">
          Illustrative brief — Mend is in development
        </figcaption>
      ) : null}
    </figure>
  );
}

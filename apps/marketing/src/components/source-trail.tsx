// The Source Trail — the sources pane of the run audit: every source the
// agent opened, grouped by how it was treated, with the selected source's
// full account (why it was opened, what the agent took, provenance).
// Rebuilt from the canonical product mock in the evidence-review tokens.

const GROUPS: ReadonlyArray<{
  label: string;
  count: number;
  items: ReadonlyArray<{
    kind: string;
    title: string;
    meta: string;
    selected?: boolean;
  }>;
}> = [
  {
    label: "Relied on",
    count: 3,
    items: [
      { kind: "DOC", title: "ISO 4217 currency minor units", meta: "six-group.com · 02:04" },
      {
        kind: "DOC",
        title: "Provider rounding specification",
        meta: "docs.payment-provider.example · 02:10",
      },
      {
        kind: "ISS",
        title: "Issue #5187 and reported order",
        meta: "acme/billing-service · 00:18",
      },
    ],
  },
  {
    label: "Consulted",
    count: 2,
    items: [
      {
        kind: "GH",
        title: "stripe/stripe-node",
        meta: "github.com/stripe/stripe-node · 02:42",
        selected: true,
      },
      {
        kind: "WEB",
        title: "MDN · Number.prototype.toFixed",
        meta: "developer.mozilla.org · 01:55",
      },
    ],
  },
  {
    label: "Contradicted",
    count: 1,
    items: [
      {
        kind: "WEB",
        title: "Per-line remainder allocation (forum answer)",
        meta: "stackoverflow.com · 03:10",
      },
    ],
  },
  {
    label: "Discarded",
    count: 1,
    items: [
      {
        kind: "REPO",
        title: "Remainder-distribution experiment",
        meta: "workspace · scratch branch · 03:17",
      },
    ],
  },
];

const PROVENANCE = [
  "Reference only",
  "No code copied",
  "MIT license",
  "Archived snapshot",
] as const;

function KindTag({ kind }: { kind: string }) {
  return (
    <span className="inline-flex w-9 shrink-0 justify-center rounded-md border border-rule px-1 py-0.5 font-mono text-[0.56rem] tracking-[0.04em] text-faint">
      {kind}
    </span>
  );
}

function SourceList() {
  return (
    <div className="min-w-0 flex-1 border-b border-rule lg:border-r lg:border-b-0">
      {GROUPS.map((group) => (
        <div key={group.label}>
          <p className="ev-eyebrow border-b border-rule-faint bg-[var(--sw-sunken)] px-5 py-1.5">
            {group.label} · {group.count}
          </p>
          {group.items.map((item) => (
            <div
              key={item.title}
              className={`flex items-start gap-3 border-b border-rule-faint px-5 py-2.5 last:border-b-0 ${
                item.selected ? "border-l-2 border-l-primary bg-[var(--sw-wash)]" : ""
              }`}
            >
              <KindTag kind={item.kind} />
              <div className="min-w-0">
                <p className="truncate text-[0.82rem] font-medium text-foreground">{item.title}</p>
                <p className="mt-0.5 truncate font-mono text-[0.66rem] text-faint">{item.meta}</p>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function SourceDetail() {
  return (
    <div className="w-full shrink-0 px-5 py-5 lg:w-[21rem] sm:px-6">
      <p className="flex items-center gap-2">
        <KindTag kind="GH" />
        <span className="font-mono text-[0.72rem] text-primary">Consulted</span>
      </p>
      <h4 className="mt-3 font-display text-base font-semibold tracking-[-0.01em] text-foreground">
        stripe/stripe-node
      </h4>
      <p className="mt-1.5 font-mono text-[0.68rem] leading-relaxed text-muted-foreground">
        commit 8f27c1a
        <br />
        src/currency.ts · lines 41–68
        <br />
        accessed 02:42 into the run
      </p>

      <div className="mt-5 space-y-4">
        <div>
          <p className="text-[0.78rem] font-medium text-label">Why it was opened</p>
          <p className="mt-1 text-[0.8rem] leading-relaxed text-foreground">
            To compare how the provider applies currency-specific minor units before capture.
          </p>
        </div>
        <div>
          <p className="text-[0.78rem] font-medium text-label">What the agent took from it</p>
          <p className="mt-1 text-[0.8rem] leading-relaxed text-foreground">
            JPY uses zero decimal places and BHD uses three. The provider rounds the final amount,
            not each line's allocated discount.
          </p>
        </div>
        <div>
          <p className="text-[0.78rem] font-medium text-label">Used in</p>
          <p className="mt-1 font-mono text-[0.7rem] leading-relaxed text-muted-foreground">
            lib/invoice/round.ts · lines 6–7
            <br />
            review question 03 · Currency rounding
          </p>
        </div>
        <div>
          <p className="text-[0.78rem] font-medium text-label">Provenance</p>
          <p className="mt-1.5 flex flex-wrap gap-1.5">
            {PROVENANCE.map((p) => (
              <span
                key={p}
                className="rounded-md border border-rule px-2 py-0.5 font-mono text-[0.62rem] text-muted-foreground"
              >
                {p}
              </span>
            ))}
          </p>
        </div>
      </div>

      <p className="mt-5 border-t border-rule-faint pt-4 font-mono text-[0.7rem] text-primary">
        Open archived snapshot · Show linked code
      </p>
    </div>
  );
}

export function SourceTrail({
  illustrative = false,
  className = "",
}: {
  readonly illustrative?: boolean;
  readonly className?: string;
}) {
  return (
    <figure className={`min-w-0 ${className}`}>
      <div className="overflow-hidden rounded-2xl border border-border bg-panel shadow-[var(--shadow-md)]">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-rule bg-[var(--sw-sunken)] px-5 py-3">
          <span className="font-mono text-[0.72rem] text-ink-2">
            Run audit <span className="text-faint">· #5204 · 7 sources</span>
          </span>
          <span className="flex items-center gap-4 font-mono text-[0.68rem]">
            <span className="text-faint">Milestones</span>
            <span className="text-faint">Full trace</span>
            <span className="text-primary">Sources</span>
          </span>
        </div>
        <div className="flex flex-col lg:flex-row">
          <SourceList />
          <SourceDetail />
        </div>
      </div>
      {illustrative ? (
        <figcaption className="mt-3 text-center font-mono text-[0.62rem] tracking-[0.04em] text-faint uppercase">
          Illustrative run audit — Mend is in development
        </figcaption>
      ) : null}
    </figure>
  );
}

// HOW IT WORKS — the queue, shown honestly as work in progress. Issues flow
// triage → queued → mending → review → PR opened; the board exhibit is a
// static preview of that surface. Cards are quiet panels with dot+word status;
// exactly one card is live (the mending run), streaming its latest event.

import { BuildingNow, Container, Eyebrow, Reveal, SectionHead } from "#/components/primitives";

type CardTone = "pending" | "queued" | "running" | "review" | "opened";

interface QueueCard {
  readonly ref: string;
  readonly title: string;
  readonly meta?: string;
  readonly tone: CardTone;
  readonly word?: string;
}

interface QueueColumn {
  readonly stage: string;
  readonly cards: ReadonlyArray<QueueCard>;
}

const COLUMNS: ReadonlyArray<QueueColumn> = [
  {
    stage: "Triage",
    cards: [
      { ref: "#219", title: "Export CSV drops header row", tone: "pending", word: "Unread" },
      { ref: "#226", title: "Retry webhook deliveries", tone: "pending", word: "Unread" },
    ],
  },
  {
    stage: "Queued",
    cards: [
      { ref: "#217", title: "Rate-limit login attempts", tone: "queued", word: "Priority 1" },
      { ref: "#222", title: "Nightly invoice job times out", tone: "queued", word: "Priority 2" },
    ],
  },
  {
    stage: "Mending",
    cards: [
      {
        ref: "#214",
        title: "Invoice totals drift by a cent",
        meta: "00:26.882 · file.modified · src/invoice.ts",
        tone: "running",
        word: "Run live",
      },
    ],
  },
  {
    stage: "Review",
    cards: [
      {
        ref: "#209",
        title: "Timezone off-by-one in digest",
        meta: "draft PR #218 · brief ready",
        tone: "review",
        word: "Brief ready",
      },
    ],
  },
  {
    stage: "Merged",
    cards: [
      {
        ref: "#204",
        title: "Null customer on refund path",
        meta: "PR #212 · merged c41f9ae",
        tone: "opened",
        word: "Merged",
      },
    ],
  },
];

const TONE_DOT: Record<CardTone, string> = {
  pending: "bg-transparent ring-[1.5px] ring-[#b3b0a8]",
  queued: "bg-transparent ring-[1.5px] ring-[#b3b0a8]",
  running: "bg-primary",
  review: "bg-[var(--sw-amber)]",
  opened: "bg-[var(--sw-green-dot)]",
};

const TONE_TEXT: Record<CardTone, string> = {
  pending: "text-muted-foreground",
  queued: "text-muted-foreground",
  running: "text-primary",
  review: "text-warning",
  opened: "text-success",
};

function Card({ card }: { card: QueueCard }) {
  const live = card.tone === "running";
  return (
    <div
      className={`rounded-xl border bg-panel p-3 shadow-[var(--shadow-xs)] ${
        live ? "border-primary/40" : "border-rule"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[0.68rem] text-faint">{card.ref}</span>
        {card.word ? (
          <span className="inline-flex items-center gap-1.5">
            <span
              className={`size-1.5 rounded-full ${TONE_DOT[card.tone]} ${live ? "mend-status-running" : ""}`}
              aria-hidden="true"
            />
            <span className={`font-mono text-[0.62rem] ${TONE_TEXT[card.tone]}`}>{card.word}</span>
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 text-[0.8rem] leading-snug font-medium text-foreground">{card.title}</p>
      {card.meta ? (
        <p className="mt-2 truncate font-mono text-[0.64rem] text-faint">{card.meta}</p>
      ) : null}
    </div>
  );
}

export function HowItWorks() {
  return (
    <section id="how" className="bg-[var(--sw-canvas)] py-24 lg:py-32">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHead
            eyebrow={<Eyebrow>How it works</Eyebrow>}
            title="From issue to merged, stage by stage."
            intro={
              <p>
                Issues come in from your tracker — GitHub, Linear, or Jira. A human drags them from
                triage into the queue and sets the order; a coding agent picks each one up in a
                fresh recorded workspace, and the run streams onto its card while it works. Mend
                never chooses its own work.
              </p>
            }
          />
          <Reveal className="pb-1">
            <BuildingNow />
          </Reveal>
        </div>

        <Reveal className="mt-12">
          <figure className="min-w-0">
            <div className="overflow-hidden rounded-2xl border border-border bg-[var(--sw-bg)] shadow-[var(--shadow-md)]">
              <div className="flex items-center justify-between gap-3 border-b border-rule px-5 py-3.5">
                <span className="ev-eyebrow text-faint">Queue · acme/billing-service</span>
                <span className="font-mono text-xs text-faint">7 issues · 1 run live</span>
              </div>
              <div className="overflow-x-auto">
                <div className="grid min-w-[56rem] grid-cols-5 gap-3 p-4 sm:p-5">
                  {COLUMNS.map((column) => (
                    <div key={column.stage} className="min-w-0">
                      <div className="flex items-baseline justify-between px-1">
                        <span className="ev-eyebrow">{column.stage}</span>
                        <span className="font-mono text-[0.64rem] text-faint">
                          {column.cards.length}
                        </span>
                      </div>
                      <div className="mt-2.5 space-y-2.5">
                        {column.cards.map((card) => (
                          <Card key={card.ref} card={card} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <figcaption className="mt-3 text-center font-mono text-[0.62rem] tracking-[0.04em] text-faint uppercase">
              Illustrative queue — in development
            </figcaption>
          </figure>
        </Reveal>

        <Reveal className="mt-10 grid gap-5 sm:grid-cols-3">
          {(
            [
              [
                "Drafts by default",
                "Every successful run opens a draft PR immediately, with the brief as its description. Approving in Mend merges it on GitHub, respecting branch protection. (A gated mode opens the PR only on approval.)",
              ],
              [
                "Failures come back useful",
                "A run that can't fix the issue opens nothing. Mend comments on the issue with what it tried, what it observed, and a link to the run audit.",
              ],
              [
                "Iteration stays on the record",
                "Comment on the brief and Mend acts on it: a follow-up run on the same branch, or a question back. New commits land on the same draft PR and the brief recompiles.",
              ],
            ] as const
          ).map(([title, body]) => (
            <div
              key={title}
              className="rounded-2xl border border-border bg-background p-6 shadow-[var(--shadow-xs)]"
            >
              <h3 className="font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
                {title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </Reveal>
      </Container>
    </section>
  );
}

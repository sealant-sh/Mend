// THE MOBILE APP — three iPhone-framed screens of the same surfaces the web
// app has: the queue, a live run, and PR review with its evidence. Honest
// status: the app is in design; the mocks are labelled illustrative.

import { AppHeader, AppStatus, IPhoneFrame } from "#/components/iphone";
import { BuildingNow, Container, Eyebrow, Reveal, SectionHead } from "#/components/primitives";

// ── Screen 1 — the queue ─────────────────────────────────────────────────────

interface QueueRow {
  readonly ref: string;
  readonly title: string;
  readonly word: string;
  readonly dot: string;
  readonly text: string;
  readonly pulse?: boolean;
}

const QUEUE_GROUPS: ReadonlyArray<readonly [string, ReadonlyArray<QueueRow>]> = [
  [
    "Mending",
    [
      {
        ref: "#214",
        title: "Invoice totals drift by a cent",
        word: "Run live",
        dot: "bg-primary",
        text: "text-primary",
        pulse: true,
      },
    ],
  ],
  [
    "Review",
    [
      {
        ref: "#209",
        title: "Timezone off-by-one in digest",
        word: "Brief ready",
        dot: "bg-[var(--sw-amber)]",
        text: "text-warning",
      },
    ],
  ],
  [
    "Queued",
    [
      {
        ref: "#217",
        title: "Rate-limit login attempts",
        word: "Priority 1",
        dot: "bg-transparent ring-[1.5px] ring-[#b3b0a8]",
        text: "text-muted-foreground",
      },
      {
        ref: "#222",
        title: "Nightly invoice job times out",
        word: "Priority 2",
        dot: "bg-transparent ring-[1.5px] ring-[#b3b0a8]",
        text: "text-muted-foreground",
      },
    ],
  ],
];

function QueueScreen() {
  return (
    <div>
      <AppHeader title="Queue" meta="acme/billing-service · 7 issues" />
      {QUEUE_GROUPS.map(([stage, rows]) => (
        <div key={stage}>
          <p className="ev-eyebrow border-b border-rule-faint bg-[var(--sw-sunken)] px-5 py-1.5">
            {stage}
          </p>
          {rows.map((row) => (
            <div key={row.ref} className="border-b border-rule-faint px-5 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[0.64rem] text-faint">{row.ref}</span>
                <AppStatus
                  word={row.word}
                  dot={row.dot}
                  text={row.text}
                  pulse={row.pulse ?? false}
                />
              </div>
              <p className="mt-1 text-[0.8rem] leading-snug font-medium text-foreground">
                {row.title}
              </p>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Screen 2 — a live run ────────────────────────────────────────────────────

const LIVE_EVENTS: ReadonlyArray<readonly [string, string, string?]> = [
  ["00:00.000", "workspace.ready"],
  ["00:07.115", "process.started", "pnpm install"],
  ["00:14.628", "process.exited", "exit 0"],
  ["00:19.310", "process.exited", "pnpm test · exit 1"],
  ["00:24.190", "file.opened", "src/invoice.ts"],
  ["00:26.882", "file.modified", "src/invoice.ts"],
];

function RunScreen() {
  return (
    <div>
      <AppHeader title="Mending #214" meta="run mnd_4c7t · acme/billing-service" />
      <div className="flex items-center justify-between border-b border-rule px-5 py-2.5">
        <AppStatus word="Run live" dot="bg-primary" text="text-primary" pulse />
        <span className="font-mono text-[0.62rem] text-faint">87 events</span>
      </div>
      <div>
        {LIVE_EVENTS.map(([offset, name, detail]) => (
          <div key={offset} className="border-b border-rule-faint px-5 py-2 font-mono">
            <div className="flex items-baseline gap-2">
              <span className="text-[0.62rem] text-faint tabular-nums">{offset}</span>
              <span className="text-[0.68rem] text-ink-2">{name}</span>
            </div>
            {detail ? (
              <p className="mt-0.5 text-[0.64rem] text-muted-foreground">{detail}</p>
            ) : null}
          </div>
        ))}
        <p className="px-5 py-2.5 font-mono text-[0.62rem] text-faint">streaming…</p>
      </div>
    </div>
  );
}

// ── Screen 3 — review ────────────────────────────────────────────────────────

function ReviewScreen() {
  return (
    <div className="flex flex-col">
      <AppHeader title="Review #214" meta="mend/invoice-rounding → main" />
      <dl>
        {(
          [
            ["Changes", "2 files · +9 / −6"],
            ["Checks", "14 passed"],
            ["Record", "212 events"],
          ] as const
        ).map(([k, v]) => (
          <div
            key={k}
            className="grid grid-cols-[4.4rem_1fr] gap-x-3 border-b border-rule-faint px-5 py-2"
          >
            <dt className="ev-eyebrow text-faint">{k}</dt>
            <dd className="min-w-0 truncate font-mono text-[0.68rem] text-ink-2">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="border-b border-rule-faint bg-[var(--sw-sunken)] px-5 py-1.5 font-mono text-[0.62rem] text-faint">
        src/invoice.ts
      </div>
      <div className="px-5 py-2 font-mono text-[0.66rem]">
        <pre className="overflow-x-auto border-l-2 border-[var(--sw-del-edge)] bg-[var(--sw-del-bg)] py-[0.15rem] pl-2 text-ink-2">
          <code>- return round(subtotal)</code>
        </pre>
        <pre className="overflow-x-auto border-l-2 border-[var(--sw-add-edge)] bg-[var(--sw-add-bg)] py-[0.15rem] pl-2 text-ink-2">
          <code>+ return round(discounted)</code>
        </pre>
      </div>
      <div className="mt-auto px-5 pt-2 pb-3">
        <span className="flex min-h-10 w-full items-center justify-center rounded-xl bg-primary font-sans text-[0.8rem] font-medium text-primary-foreground shadow-[var(--shadow-cobalt)]">
          Approve and merge
        </span>
        <p className="mt-2 text-center font-mono text-[0.6rem] text-faint">
          Merges draft PR #218 into main
        </p>
      </div>
    </div>
  );
}

// ── The section ──────────────────────────────────────────────────────────────

export function Mobile() {
  return (
    <section id="mobile" className="bg-[var(--sw-bg)] py-24 lg:py-32">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHead
            eyebrow={<Eyebrow>The mobile app</Eyebrow>}
            title="The whole loop, from your phone."
            intro={
              <p>
                Runs take minutes; you don't have to be at a desk while they do. The app carries the
                same surfaces as the web — the queue, the live run, the brief — and approving from
                the phone merges, same as at the desk.
              </p>
            }
          />
          <Reveal className="pb-1">
            <BuildingNow word="In design" />
          </Reveal>
        </div>

        <Reveal className="mt-14">
          <div className="flex flex-wrap items-start justify-center gap-8 lg:gap-12">
            <IPhoneFrame caption="The queue" className="lg:translate-y-6">
              <QueueScreen />
            </IPhoneFrame>
            <IPhoneFrame caption="A run, live">
              <RunScreen />
            </IPhoneFrame>
            <IPhoneFrame caption="The brief" className="lg:translate-y-6">
              <ReviewScreen />
            </IPhoneFrame>
          </div>
          <p className="mt-10 text-center font-mono text-[0.62rem] tracking-[0.04em] text-faint uppercase">
            Illustrative screens — the app is in design
          </p>
        </Reveal>
      </Container>
    </section>
  );
}

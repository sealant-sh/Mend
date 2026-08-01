// ANY DEVICE — the phone is the proof that the session no longer belongs to
// the desk. The three frames show what the development app actually supports;
// the review is deliberately read-only until mobile comments ship.

import { AppHeader, AppStatus, IPhoneFrame } from "#/components/iphone";
import { AvailableNow, Container, Eyebrow, Reveal, SectionHead } from "#/components/primitives";

// ── Screen 1 — the Now inbox ─────────────────────────────────────────────────

interface NowRow {
  readonly where: string;
  readonly title: string;
  readonly word: string;
  readonly dot: string;
  readonly text: string;
  readonly pulse?: boolean;
}

const NOW_GROUPS: ReadonlyArray<readonly [string, ReadonlyArray<NowRow>]> = [
  [
    "Needs you",
    [
      {
        where: "claude · billing-service",
        title: "Keep the legacy callback or remove it?",
        word: "Waiting",
        dot: "bg-[var(--sw-amber)]",
        text: "text-warning",
      },
    ],
  ],
  [
    "Ready to review",
    [
      {
        where: "codex · sealantd",
        title: "4 files · +86 / −12 · 2 checks observed",
        word: "Settled",
        dot: "bg-[var(--sw-green-dot)]",
        text: "text-success",
      },
    ],
  ],
  [
    "Active",
    [
      {
        where: "claude · mend",
        title: "pnpm test · running 00:41",
        word: "Running",
        dot: "bg-primary",
        text: "text-primary",
        pulse: true,
      },
    ],
  ],
];

function NowScreen() {
  return (
    <div>
      <AppHeader title="Now" meta="3 sessions · 2 projects · this machine" />
      {NOW_GROUPS.map(([stage, rows]) => (
        <div key={stage}>
          <p className="ev-eyebrow border-b border-rule-faint bg-[var(--sw-sunken)] px-5 py-1.5">
            {stage}
          </p>
          {rows.map((row) => (
            <div key={row.where} className="border-b border-rule-faint px-5 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-mono text-[0.64rem] text-faint">{row.where}</span>
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

// ── Screen 2 — a session, live ───────────────────────────────────────────────

function SessionScreen() {
  return (
    <div className="flex flex-col">
      <AppHeader title="claude · billing-service" meta="session 01J8QK4M · recording" />
      <div className="flex items-center justify-between border-b border-rule px-5 py-2.5">
        <AppStatus word="Running · recorded" dot="bg-primary" text="text-primary" pulse />
        <span className="font-mono text-[0.62rem] text-faint">212 events</span>
      </div>
      <div className="bg-[var(--sw-sunken)] px-5 py-3 font-mono text-[0.64rem] leading-[1.8]">
        <p className="text-ink-2">⏺ I'll keep the DB-session path and remove</p>
        <p className="text-ink-2"> the legacy callback. Running the suite…</p>
        <p className="mt-1 text-muted-foreground">$ pnpm test auth</p>
        <p className="text-success">✓ 41 passed (3.2s)</p>
        <p className="mt-1 text-ink-2">? Keep legacy() exported for the</p>
        <p className="text-ink-2"> migration window? (y/n)</p>
      </div>
      <div className="mt-auto px-5 pt-3 pb-3">
        <div className="flex min-h-9 items-center rounded-xl border border-rule bg-background px-3.5">
          <span className="text-[0.74rem] text-faint">No — migration ended in June.</span>
        </div>
        <p className="mt-2 text-center font-mono text-[0.6rem] text-faint">
          attached over your tailnet
        </p>
      </div>
    </div>
  );
}

// ── Screen 3 — the review ────────────────────────────────────────────────────

function ReviewScreen() {
  return (
    <div className="flex flex-col">
      <AppHeader title="Review" meta="billing-service · worktree vs base" />
      <dl>
        {(
          [
            ["Change", "4 files · +86 / −12"],
            ["Record", "212 events"],
            ["Mode", "read-only on mobile"],
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
        src/auth/session.ts
      </div>
      <div className="px-5 py-2 font-mono text-[0.66rem]">
        <pre className="overflow-x-auto border-l-2 border-[var(--sw-del-edge)] bg-[var(--sw-del-bg)] py-[0.15rem] pl-2 text-ink-2">
          <code>- if (legacyCallback) return legacy(req)</code>
        </pre>
        <pre className="overflow-x-auto border-l-2 border-[var(--sw-add-edge)] bg-[var(--sw-add-bg)] py-[0.15rem] pl-2 text-ink-2">
          <code>+ return dbSession(req)</code>
        </pre>
      </div>
      <div className="mt-auto px-5 pt-3 pb-3">
        <span className="flex min-h-10 w-full items-center justify-center rounded-xl border border-rule bg-background font-sans text-[0.8rem] font-medium text-foreground shadow-[var(--shadow-xs)]">
          Read the full diff
        </span>
        <p className="mt-2 text-center font-mono text-[0.6rem] text-warning">
          Inline comments and send-review are next
        </p>
      </div>
    </div>
  );
}

// ── The section ──────────────────────────────────────────────────────────────

export function Mobile() {
  return (
    <section id="phone" className="bg-[var(--sw-bg)] py-24 lg:py-32">
      <Container>
        <SectionHead
          eyebrow={<Eyebrow>Any device</Eyebrow>}
          title="The same session, from your phone."
          intro={
            <p>
              The development app connects to a real Mend host: see what is running, start or resume
              an agent, message a live session, open its terminal, read the local diff. A control
              and review surface — not an IDE on a small screen.
            </p>
          }
        />
        <Reveal className="mt-6">
          <AvailableNow word="Working today" />
        </Reveal>

        <Reveal className="mt-14">
          <div className="flex flex-wrap items-start justify-center gap-8 lg:gap-12">
            <IPhoneFrame caption="Now" className="lg:translate-y-6">
              <NowScreen />
            </IPhoneFrame>
            <IPhoneFrame caption="A session, live">
              <SessionScreen />
            </IPhoneFrame>
            <IPhoneFrame caption="The review" className="lg:translate-y-6">
              <ReviewScreen />
            </IPhoneFrame>
          </div>
          <p className="mt-10 text-center font-mono text-[0.62rem] tracking-[0.04em] text-faint uppercase">
            Illustrative data — capabilities available in the development app
          </p>
        </Reveal>

        <Reveal className="mt-10">
          <p className="mx-auto max-w-[68ch] text-center leading-relaxed text-muted-foreground">
            The app reaches the Mend host over your LAN or tailnet with an operator token. Nothing
            is exposed publicly.
          </p>
        </Reveal>
      </Container>
    </section>
  );
}

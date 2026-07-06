// WHY — the problem, with the problem shown. Left: three facts, each
// checkable against the reader's own experience. Right: the foil — a typical
// agent PR as it arrives today, dimmed and desaturated. The only "before"
// artifact on the page; every other exhibit is the fix.

import { Container, Eyebrow, Reveal, SectionHead } from "#/components/primitives";

const PROBLEMS: ReadonlyArray<readonly [string, string]> = [
  [
    "The summary reviews itself",
    "The description on an agent PR is written by the model that made the change. If it missed something, its summary misses it too.",
  ],
  [
    "The workspace is gone",
    "By review time, the environment that produced the change has been torn down. What ran, what failed first, what else was touched — unrecoverable.",
  ],
  [
    "So the diff is all you get",
    "Agent PRs merge unread, or queue until they rot. Reviewing one properly means re-deriving the work yourself, which is the job the agent was supposed to remove.",
  ],
];

// The foil: today's agent PR. Deliberately in the banned register — the model
// rendering a verdict on its own work — because that is the artifact under
// critique. Dimmed so it reads as the "before", never as this page's voice.
function FoilPR() {
  return (
    <figure className="min-w-0">
      <div className="overflow-hidden rounded-2xl border border-border bg-background opacity-90 shadow-[var(--shadow-sm)] saturate-[.45]">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-rule bg-[var(--sw-sunken)] px-5 py-3">
          <span className="min-w-0 truncate font-mono text-[0.72rem] text-ink-2">
            acme/billing-service <span className="text-faint">/</span> #5199
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-[var(--sw-green-dot)]" aria-hidden="true" />
            <span className="font-mono text-[0.68rem] text-success">All checks passed</span>
          </span>
        </div>
        <div className="px-5 py-5 sm:px-6">
          <h3 className="font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
            Fix invoice rounding bug
          </h3>
          <p className="mt-1 font-mono text-[0.68rem] text-faint">
            agent-bot wants to merge 1 commit into main
          </p>
          <div className="mt-4 rounded-xl border border-rule-faint bg-panel px-4 py-3.5">
            <p className="text-[0.86rem] leading-relaxed text-ink-2">
              I've identified and fixed the rounding issue in the invoice calculation. The discount
              is now applied before rounding, which resolves the discrepancy. I also cleaned up some
              related code and improved formatting throughout. All tests pass and this change is
              safe to merge! 🎉
            </p>
          </div>
          <dl className="mt-4">
            {(
              [
                ["Changes", "47 files · +1,204 / −356"],
                ["Conversation", "0 comments"],
                ["Workspace", "deleted 2 hours ago"],
                ["How it was made", "—"],
              ] as const
            ).map(([k, v]) => (
              <div
                key={k}
                className="grid grid-cols-[8.5rem_1fr] gap-x-3 border-b border-rule-faint py-2 last:border-b-0"
              >
                <dt className="ev-eyebrow self-center text-faint">{k}</dt>
                <dd className="min-w-0 truncate font-mono text-[0.72rem] text-ink-2">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <figcaption className="mt-3 text-center font-mono text-[0.62rem] tracking-[0.04em] text-faint uppercase">
        A typical agent PR, today — the summary is the author's own
      </figcaption>
    </figure>
  );
}

export function Why() {
  return (
    <section id="why" className="bg-panel py-24 lg:py-32">
      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-16">
          <div className="min-w-0">
            <SectionHead
              eyebrow={<Eyebrow>Why</Eyebrow>}
              title="Nobody reads the code anymore. Something has to."
              intro={
                <p>
                  Agent tooling optimized writing the change. Deciding whether to merge it is still
                  your problem — and everything you'd need to decide with disappears when the
                  agent's workspace does.
                </p>
              }
            />
            <Reveal className="mt-10 space-y-7">
              {PROBLEMS.map(([title, body]) => (
                <div key={title}>
                  <h3 className="font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
                    {title}
                  </h3>
                  <p className="mt-2 max-w-[52ch] leading-relaxed text-muted-foreground">{body}</p>
                </div>
              ))}
            </Reveal>
          </div>
          <Reveal className="min-w-0 lg:pt-8">
            <FoilPR />
          </Reveal>
        </div>
      </Container>
    </section>
  );
}

// WHY — the session is the work, but today its pieces are owned by one laptop
// and one harness. The foil is the familiar terminal pile the reader already
// has; every other exhibit on the page shows the session put back together.

import { Container, Eyebrow, Reveal, SectionHead } from "#/components/primitives";

const PROBLEMS: ReadonlyArray<readonly [string, string]> = [
  [
    "The laptop owns the work",
    "The checkout, worktree, terminal, and dev server live on whichever computer started them. Move to another computer and the work is somewhere else — unless you stop and publish it first.",
  ],
  [
    "The harness owns the conversation",
    "Claude Code, Codex, and every other agent keep their own session history. Changing models usually means abandoning the conversation or rebuilding it by hand.",
  ],
  [
    "The diff has no memory",
    "A source-control panel can show what changed. It cannot show which session changed it, what the agent was asked, what ran afterwards, or what was never exercised.",
  ],
];

// The foil: today's working day. Deliberately the artifact under critique —
// dimmed so it reads as the "before", never as this page's voice.
function FoilTerminal() {
  return (
    <figure className="min-w-0">
      <div className="overflow-hidden rounded-2xl border border-border bg-background opacity-90 shadow-[var(--shadow-sm)] saturate-[.45]">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-rule bg-[var(--sw-sunken)] px-5 py-3">
          <span className="min-w-0 truncate font-mono text-[0.72rem] text-ink-2">~ — tmux</span>
          <span className="font-mono text-[0.68rem] text-faint">3 windows</span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-rule-faint px-5 py-2 font-mono text-[0.68rem]">
          <span className="text-ink-2">0: claude · api</span>
          <span className="text-faint">
            1: codex · billing <span className="text-warning">●</span>
          </span>
          <span className="text-faint">2: claude · infra</span>
        </div>
        <div className="px-5 py-4 font-mono text-[0.74rem] leading-[1.9]">
          <p className="text-ink-2">
            <span className="text-faint select-none">$ </span>git diff --stat | tail -1
          </p>
          <p className="text-muted-foreground">
            {" "}
            23 files changed, 914 insertions(+), 212 deletions(-)
          </p>
          <p className="mt-2 text-ink-2">
            <span className="text-faint select-none">$ </span>git status --short | head -3
          </p>
          <p className="text-muted-foreground"> M src/auth/session.ts</p>
          <p className="text-muted-foreground"> M src/invoice.ts</p>
          <p className="text-muted-foreground">?? src/auth/legacy-shim.ts</p>
        </div>
        <dl className="border-t border-rule-faint px-5 py-3">
          {(
            [
              ["Work", "this checkout · this laptop"],
              ["Sessions", "3 terminals · 2 provider histories"],
              ["From your phone", "—"],
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
      <figcaption className="mt-3 text-center font-mono text-[0.62rem] tracking-[0.04em] text-faint uppercase">
        A working day, today
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
              title="A session is stuck to whatever machine started it."
              intro={
                <p>
                  A coding session is a checkout, a terminal, a provider history, a running app, and
                  the change itself. Each piece is owned by the laptop or harness that happened to
                  open it, and none of them knows about the others.
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
            <FoilTerminal />
          </Reveal>
        </div>
      </Container>
    </section>
  );
}

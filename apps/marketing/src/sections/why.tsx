// THE PROBLEMS — the five things the page exists to answer, stated as shared
// experience. The foil beside them is today's working day: the artifact under
// critique, dimmed so it reads as the "before", never as this page's voice.

import { Container, Eyebrow, Reveal, SectionHead } from "#/components/primitives";

const PROBLEMS: ReadonlyArray<readonly [string, string]> = [
  [
    "Work scattered across machines",
    "Every machine you code on collects its own clones, worktrees, and half-finished sessions. The session you need is always on the machine you're not at.",
  ],
  [
    "The harness owns the session",
    "Claude Code and Codex each keep the conversation in their own format, on the machine that ran it. Worktree, process, and history are welded together — so when a session builds up genuinely good context, you keep it running for weeks, afraid to close the terminal, because there's no way to take it anywhere else.",
  ],
  [
    "There's no phone story",
    "Checking what an agent is doing, answering its question, reading the diff — all of it means being at the machine that started it.",
  ],
  [
    "Port roulette",
    "Three worktrees, three dev servers, ports 3000 / 3001 / 5173-and-counting. Which one belongs to which session — and now open the right one from another device.",
  ],
  [
    "No local review story",
    "The agent writes to your disk, but reviewing still means pushing a branch and opening a PR. And the review tools that could help want their own cloud and their own inference bill, when you already pay for a subscription that could read the change.",
  ],
];

// The foil: the developer's actual inventory — every machine with its orphaned
// pile, and a phone that reaches none of it. Dimmed so it reads as the
// "before", never as this page's voice.
type FoilTone = "muted" | "warning";

const INVENTORY: ReadonlyArray<
  readonly [string, ReadonlyArray<readonly [string, string, FoilTone]>]
> = [
  [
    "MacBook · with you",
    [
      ["billing-service", "clone #2", "muted"],
      ["codex session", "waiting on you?", "warning"],
      ["vite on :5173", "which worktree?", "muted"],
    ],
  ],
  [
    "Desktop · at home",
    [
      ["billing-service", "clone #1", "muted"],
      ["claude session", "3 weeks of context — do not close", "warning"],
      [":3000", "still held", "muted"],
    ],
  ],
  [
    "Work laptop · office",
    [
      ["billing-service", "clone #3", "muted"],
      ["Friday's diff", "unreviewed", "muted"],
    ],
  ],
  ["Phone", [["reaches", "none of it", "muted"]]],
];

function FoilInventory() {
  return (
    <figure className="min-w-0">
      <div className="overflow-hidden rounded-2xl border border-border bg-background opacity-90 shadow-[var(--shadow-sm)] saturate-[.45]">
        {INVENTORY.map(([device, rows]) => (
          <div key={device}>
            <p className="ev-eyebrow border-b border-rule-faint bg-[var(--sw-sunken)] px-5 py-1.5">
              {device}
            </p>
            {rows.map(([label, value, tone]) => (
              <div
                key={label}
                className="flex items-baseline justify-between gap-3 border-b border-rule-faint px-5 py-2 last:border-b-0"
              >
                <span className="shrink-0 font-mono text-[0.72rem] text-ink-2">{label}</span>
                <span
                  className={`min-w-0 text-right font-mono text-[0.7rem] ${
                    tone === "warning" ? "text-warning" : "text-faint"
                  }`}
                >
                  {value}
                </span>
              </div>
            ))}
          </div>
        ))}
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
        <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-16">
          <div className="min-w-0">
            <SectionHead
              eyebrow={<Eyebrow>The problems</Eyebrow>}
              title="If you use coding agents heavily, some of this will be familiar."
            />
            <Reveal className="mt-10 space-y-7">
              {PROBLEMS.map(([title, body], i) => (
                <div key={title} className="flex gap-4">
                  <span className="pt-1 font-mono text-sm text-faint select-none">{i + 1}</span>
                  <div>
                    <h3 className="font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
                      {title}
                    </h3>
                    <p className="mt-2 max-w-[52ch] leading-relaxed text-muted-foreground">
                      {body}
                    </p>
                  </div>
                </div>
              ))}
            </Reveal>
          </div>
          <Reveal className="min-w-0 lg:sticky lg:top-24 lg:pt-8">
            <FoilInventory />
          </Reveal>
        </div>
      </Container>
    </section>
  );
}

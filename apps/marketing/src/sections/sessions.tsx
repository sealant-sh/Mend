// HOW IT WORKS — what `mend claude` actually does, stated as mechanics rather
// than promises: the store, the per-session worktree, the supervised
// workspace, and what detach/resume mean. The hero already showed the moment;
// this section explains it.

import {
  AvailableNow,
  BuildingNow,
  Container,
  Eyebrow,
  Reveal,
  SectionHead,
} from "#/components/primitives";

const FACTS: ReadonlyArray<readonly [string, string]> = [
  [
    "One store, one worktree per session",
    "mend adopt clones the repository into a central store on the Mend host. Each session runs in its own git worktree there, so parallel agents cannot collide and no client checkout becomes the source of truth.",
  ],
  [
    "Detach without stopping",
    "The agent runs in a supervised workspace, not in the terminal window that displays it. Close the client and the process keeps running; reattach later from the CLI, the web app, or the phone with the scrollback intact.",
  ],
  [
    "Resume, or switch harnesses",
    "A settled session reopens with the same harness and its native state. Reopening a Claude Code session in Codex — or the reverse — works in beta: same worktree, translated conversation history.",
  ],
];

export function Sessions() {
  return (
    <section id="how" className="bg-[var(--sw-canvas)] py-24 lg:py-32">
      <Container>
        <SectionHead
          eyebrow={<Eyebrow>How it works</Eyebrow>}
          title="mend claude is the Claude Code you already run."
          intro={
            <p>
              <code className="font-mono text-[0.85em] text-foreground">mend claude</code>,{" "}
              <code className="font-mono text-[0.85em] text-foreground">mend codex</code>, or{" "}
              <code className="font-mono text-[0.85em] text-foreground">mend run -- anything</code>.
              The TUI, shortcuts, and connected subscription are unchanged. Mend adds a durable
              worktree under the agent and a recorded workspace around it.
            </p>
          }
        />
        <Reveal className="mt-6 flex flex-wrap items-center gap-4">
          <AvailableNow word="Core loop working" />
          <BuildingNow word="Cross-harness beta" />
        </Reveal>

        <Reveal className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-3">
          {FACTS.map(([title, body]) => (
            <div key={title}>
              <h3 className="font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
                {title}
              </h3>
              <p className="mt-2 leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </Reveal>
      </Container>
    </section>
  );
}

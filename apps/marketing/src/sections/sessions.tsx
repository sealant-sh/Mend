// HOW IT WORKS — what `mend codex` actually does: the store, the per-session
// worktree, the supervised workspace, detach and resume.

import { Container, Eyebrow, Reveal, SectionHead } from "#/components/primitives";

const FACTS: ReadonlyArray<readonly [string, string]> = [
  [
    "One store, one worktree per session",
    "mend adopt clones the repository into a central store on your server. Each session runs in its own git worktree there, so parallel agents can't collide and you stop keeping a clone per machine.",
  ],
  [
    "Detach without stopping",
    "The agent runs in a supervised workspace, not in the terminal window that displays it. Close the laptop and the process keeps running; reattach later from the CLI, the web app, or your phone with the scrollback intact.",
  ],
  [
    "Resume, or switch harnesses",
    "A finished session reopens with the same harness and its native state. You can also reopen a Claude Code session in Codex, or the reverse: same worktree, translated conversation history.",
  ],
];

export function Sessions() {
  return (
    <section id="how" className="bg-[var(--sw-canvas)] py-24 lg:py-32">
      <Container>
        <SectionHead
          eyebrow={<Eyebrow>How it works</Eyebrow>}
          title="The same tools, running on your server."
          intro={
            <p>
              <code className="font-mono text-[0.85em] text-foreground">mend claude</code>,{" "}
              <code className="font-mono text-[0.85em] text-foreground">mend codex</code>, or{" "}
              <code className="font-mono text-[0.85em] text-foreground">mend run -- anything</code>{" "}
              — the same TUI, shortcuts, and subscription you use today. Mend puts a durable
              worktree under the agent and records the session around it.
            </p>
          }
        />

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

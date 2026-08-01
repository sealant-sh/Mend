// BRING YOUR AGENT — the lowest-friction on-ramp: add `mend` to the command
// the reader already types. The CLI exhibit proves machine portability,
// durable detach, and the harness-agnostic session model in one sequence.

import {
  AvailableNow,
  BuildingNow,
  Container,
  Eyebrow,
  Reveal,
  SectionHead,
} from "#/components/primitives";

// One terminal line: prompt lines in ink, output in muted, comments faint.
type LineTone = "cmd" | "out" | "live" | "note" | "blank";

const LINES: ReadonlyArray<readonly [LineTone, string]> = [
  ["cmd", "mend adopt https://github.com/acme/billing-service"],
  ["out", "adopted · ~/.mend/store/billing-service/repo.git · main"],
  ["blank", ""],
  ["cmd", "mend claude"],
  ["live", "session 01J8QK4M · worktree mend/session/01J8QK4M · recording"],
  ["out", "▐ the same Claude Code TUI · inside Mend's supervised workspace"],
  ["blank", ""],
  ["note", "^] detached — the session keeps running"],
  ["blank", ""],
  ["cmd", "mend attach 01J8"],
  ["note", "# same bytes on another computer · same session in web from your phone"],
  ["blank", ""],
  ["note", "# after the work settles, reopen Claude Code in Codex (or vice versa)"],
  ["cmd", "mend resume 01J8 --with codex"],
  ["note", "# same worktree · translated conversation history · cross-harness beta"],
];

function Terminal() {
  return (
    <div className="overflow-x-auto rounded-2xl border border-rule bg-[var(--sw-sunken)] px-5 py-5 font-mono text-[0.78rem] leading-[1.85] shadow-[var(--shadow-sm)]">
      <pre>
        <code>
          {LINES.map(([tone, text], i) => (
            <span key={i} className="block whitespace-pre">
              {tone === "blank" ? (
                <span> </span>
              ) : tone === "cmd" ? (
                <>
                  <span className="text-faint select-none">$ </span>
                  <span className="text-ink-2">{text}</span>
                </>
              ) : tone === "live" ? (
                <>
                  <span className="text-muted-foreground">
                    {text.slice(0, text.length - "recording".length)}
                  </span>
                  <span className="text-success">recording</span>
                </>
              ) : tone === "note" ? (
                <span className="text-faint">{text}</span>
              ) : (
                <span className="text-muted-foreground">{text}</span>
              )}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

const FACTS: ReadonlyArray<readonly [string, string]> = [
  [
    "The Mend host owns the work",
    "Adoption clones the repository into one store on a machine you control. Every session gets its own worktree there, so parallel agents cannot collide and no client laptop becomes the source of truth.",
  ],
  [
    "Detach from the screen, not the session",
    "The agent runs in a supervised workspace, not in the terminal window displaying it. Close a client laptop while the Mend host stays online, then reattach through the CLI, web, or phone without losing the process or its scrollback.",
  ],
  [
    "Switch the driver; keep the work",
    "Resume with the original harness and its native state today. You can also reopen a settled Claude Code session in Codex and vice versa; Mend translates useful conversation history while cross-harness fidelity is hardened.",
  ],
];

export function Sessions() {
  return (
    <section id="sessions" className="bg-[var(--sw-canvas)] py-24 lg:py-32">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHead
            eyebrow={<Eyebrow>Bring your agent</Eyebrow>}
            title="Add one word. Keep the agent you already use."
            intro={
              <p>
                <code className="font-mono text-[0.85em] text-foreground">mend claude</code>,{" "}
                <code className="font-mono text-[0.85em] text-foreground">mend codex</code>, or{" "}
                <code className="font-mono text-[0.85em] text-foreground">
                  mend run -- anything
                </code>
                . Keep the same TUI, shortcuts, and connected subscription. Mend puts a durable git
                worktree under the agent and a recorded workspace around it.
              </p>
            }
          />
          <Reveal className="flex flex-wrap items-center gap-4 pb-1">
            <AvailableNow word="Core loop working" />
            <BuildingNow word="Cross-harness beta" />
          </Reveal>
        </div>

        <Reveal className="mt-12">
          <Terminal />
        </Reveal>

        <Reveal className="mt-10 grid gap-5 sm:grid-cols-3">
          {FACTS.map(([title, body]) => (
            <div
              key={title}
              className="rounded-2xl bg-panel p-6 shadow-[var(--shadow-sm)] transition-[transform,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-[var(--shadow-md)]"
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

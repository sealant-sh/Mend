// UNDER THE HOOD — introduces Sealant to readers who met Mend first, and the
// technical claim behind the record: it's captured by the runtime, underneath
// the harness. Record panel beside the claim; the SDK snippet below shows the
// whole integration surface.

import { Display, Eyebrow, PLATFORM_SITE_URL, Reveal, SectionHead } from "#/components/primitives";
import { CatalogEyebrow, RunRecord } from "#/components/run-record";

// A line is a list of [text, tone] spans. Tones map to the token vocabulary.
type Tone = "kw" | "str" | "fn" | "comment" | "plain";

const CODE: ReadonlyArray<ReadonlyArray<readonly [string, Tone]>> = [
  [
    ["const", "kw"],
    [" workspace = ", "plain"],
    ["await", "kw"],
    [" sealant.workspaces.", "plain"],
    ["create", "fn"],
    ["({", "plain"],
  ],
  [["  // the session's git worktree, owned by Mend's store", "comment"]],
  [
    ["  source: { kind: ", "plain"],
    ['"mount"', "str"],
    [", path: worktree },", "plain"],
  ],
  [["})", "plain"]],
  [["", "plain"]],
  [
    ["const", "kw"],
    [" term = ", "plain"],
    ["await", "kw"],
    [" workspace.sessions.", "plain"],
    ["open", "fn"],
    ["([", "plain"],
    ['"claude"', "str"],
    ["])", "plain"],
  ],
  [["", "plain"]],
  [["// detach, reattach, replay — from any sequence, on any device", "comment"]],
  [
    ["const", "kw"],
    [" attachment = ", "plain"],
    ["await", "kw"],
    [" term.", "plain"],
    ["attach", "fn"],
    ["({ from: lastSeen })", "plain"],
  ],
  [
    ["for await", "kw"],
    [" (", "plain"],
    ["const", "kw"],
    [" chunk ", "plain"],
    ["of", "kw"],
    [" attachment.output) {", "plain"],
  ],
  [
    ["  terminal.", "plain"],
    ["write", "fn"],
    ["(chunk)", "plain"],
  ],
  [["}", "plain"]],
];

const TONE_CLASS: Record<Tone, string> = {
  kw: "text-primary",
  str: "text-success",
  fn: "text-primary",
  comment: "text-faint",
  plain: "text-ink-2",
};

function LightCode() {
  return (
    <div className="overflow-x-auto rounded-2xl border border-rule bg-[var(--sw-sunken)] px-5 py-5 font-mono text-[0.78rem] leading-[1.85] shadow-[var(--shadow-sm)]">
      <pre>
        <code>
          {CODE.map((line, i) => (
            <span key={i} className="block">
              {line.length === 1 && line[0]![0] === "" ? (
                <span> </span>
              ) : (
                line.map((part, j) => (
                  <span key={j} className={TONE_CLASS[part[1]]}>
                    {part[0]}
                  </span>
                ))
              )}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

export function Evidence() {
  return (
    <section id="evidence" className="bg-panel py-24 lg:py-32">
      <div className="mx-auto w-full max-w-[1200px] px-6 sm:px-8">
        <div className="grid items-start gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="min-w-0">
            <SectionHead
              eyebrow={<Eyebrow>Under the hood</Eyebrow>}
              title="Every session is recorded by the runtime."
              intro={
                <p>
                  Sessions run on{" "}
                  <a
                    href={PLATFORM_SITE_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="text-foreground underline decoration-[var(--sw-rule)] underline-offset-4 hover:decoration-[var(--sw-accent)]"
                  >
                    Sealant
                  </a>
                  , an open-source runtime that puts the harness in a workspace it doesn't control
                  and records from underneath it: processes, exits, file changes, terminal output,
                  network. The harness can't edit a record it doesn't write.
                </p>
              }
            />
            <Reveal className="mt-10 space-y-7">
              <div>
                <h3 className="font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
                  Review against what actually ran
                </h3>
                <p className="mt-2 max-w-[52ch] leading-relaxed text-muted-foreground">
                  Which commands ran, what they exited with, which files changed and when — the
                  review and Mend's draft comments draw on this record, so a claim in the
                  conversation and a fact from the runtime are never confused.
                </p>
              </div>
              <div>
                <h3 className="font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
                  Replay any session later
                </h3>
                <p className="mt-2 max-w-[52ch] leading-relaxed text-muted-foreground">
                  A session is a durable event log, not a scrollback buffer. Replay it during
                  review, or a month later when someone asks why the change was made.
                </p>
              </div>
            </Reveal>
          </div>

          <Reveal className="min-w-0 lg:pt-10">
            <CatalogEyebrow runId="01J8QK4M" events="212" className="mb-3 block" />
            <RunRecord
              runId="session 01J8QK4M"
              capture="00:33.415"
              status={{ word: "Completed", tone: "observed" }}
              replay
              events={[
                {
                  seq: 41,
                  offset: "00:19.310",
                  name: "process.exited",
                  detail: "pnpm test · exit 1 · reproduced",
                  provenance: "observed",
                },
                {
                  seq: 87,
                  offset: "00:26.882",
                  name: "file.modified",
                  detail: "src/invoice.ts",
                  provenance: "observed",
                },
                {
                  seq: 122,
                  offset: "00:29.514",
                  name: "harness.note",
                  detail: "locale rounding unaffected",
                  provenance: "inferred",
                },
                {
                  seq: 198,
                  offset: "00:33.415",
                  name: "process.exited",
                  detail: "pnpm test · exit 0 · 14 passed",
                  provenance: "observed",
                },
              ]}
              diff={{
                file: "src/invoice.ts",
                lines: [
                  { sign: " ", text: "const discounted = subtotal - discount(subtotal);" },
                  { sign: "-", text: "return round(subtotal) - discount(subtotal);" },
                  { sign: "+", text: "return round(discounted);" },
                ],
              }}
              footnote="checkpoint 0007 · worktree mend/session/01J8QK4M"
            />
          </Reveal>
        </div>

        <div className="mt-20 grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <Reveal className="min-w-0">
            <LightCode />
          </Reveal>
          <Reveal className="min-w-0">
            <Display className="text-2xl sm:text-3xl">No private hooks.</Display>
            <p className="mt-4 max-w-[52ch] text-lg leading-relaxed text-muted-foreground">
              This is Mend's whole integration with Sealant — the public{" "}
              <code className="font-mono text-[0.85em] text-foreground">@sealant/sdk</code> from
              npm. Mount the session's worktree into a workspace, open the harness on a PTY, attach
              to the durable stream from any sequence.
            </p>
            <p className="mt-4 max-w-[52ch] leading-relaxed text-muted-foreground">
              Anything Mend does, your own tooling can do with the same SDK.
            </p>
            <a
              href={PLATFORM_SITE_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex items-center gap-1 font-sans text-sm font-medium text-primary no-underline transition-colors hover:text-[var(--primary-hover)]"
            >
              sealant.dev →
            </a>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

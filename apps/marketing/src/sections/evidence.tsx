// THE EVIDENCE — the load-bearing section. Introduces Sealant to readers who
// met Mend first, and makes the one technical claim everything else rests on:
// the record is captured by the runtime, underneath the harness, so the model
// can't write its own account. Record panel beside the claim; the SDK snippet
// below shows there are no private hooks.

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
              eyebrow={<Eyebrow>Where the recording comes from</Eyebrow>}
              title="The record is written by the runtime, not the model."
              intro={
                <p>
                  Every Mend session runs on{" "}
                  <a
                    href={PLATFORM_SITE_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="text-foreground underline decoration-[var(--sw-rule)] underline-offset-4 hover:decoration-[var(--sw-accent)]"
                  >
                    Sealant
                  </a>
                  , an open-source runtime that puts the harness in a workspace it doesn't control
                  and records the session from underneath it: processes, exits, file changes,
                  terminal output, network. The harness can't embellish a record it doesn't write.
                </p>
              }
            />
            <Reveal className="mt-10 space-y-7">
              <div>
                <h3 className="font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
                  Runtime events are observations
                </h3>
                <p className="mt-2 max-w-[52ch] leading-relaxed text-muted-foreground">
                  Processes, exits, file changes, and terminal bytes come from the runtime record.
                  What the harness says remains conversation, not proof that something happened.
                  Hunk-level provenance inside Mend's review is still in development.
                </p>
              </div>
              <div>
                <h3 className="font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
                  The record outlives the terminal
                </h3>
                <p className="mt-2 max-w-[52ch] leading-relaxed text-muted-foreground">
                  A session is a durable event log, not a scrollback buffer. Replay it during
                  review, or a month later when someone asks why the change was made.
                </p>
              </div>
              <div>
                <h3 className="font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
                  Observations, not verdicts
                </h3>
                <p className="mt-2 max-w-[52ch] leading-relaxed text-muted-foreground">
                  Mend reports what happened and stops there. No confidence scores, no "safe to
                  merge". You decide what lands — with the evidence in front of you.
                </p>
              </div>
            </Reveal>
          </div>

          <Reveal className="min-w-0 lg:pt-10">
            <CatalogEyebrow runId="01J8QK4M" events="212" className="mb-3 block" />
            <RunRecord
              runId="session 01J8QK4M"
              capture="00:33.415"
              status={{ word: "Completed · observed", tone: "observed" }}
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
              illustrative
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
              Anything Mend does, your own tooling can do. If you'd rather build your own workflow
              than adopt this one, the runtime underneath is the part to take.
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

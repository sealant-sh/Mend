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
    [" sandbox = ", "plain"],
    ["await", "kw"],
    [" sealant.sandboxes.", "plain"],
    ["create", "fn"],
    ["({", "plain"],
  ],
  [
    ["  repository: ", "plain"],
    ["issue.repository", "plain"],
    [",", "plain"],
  ],
  [
    ["  harness: ", "plain"],
    ["opencode", "fn"],
    ["(),", "plain"],
  ],
  [["})", "plain"]],
  [["", "plain"]],
  [
    ["const", "kw"],
    [" run = ", "plain"],
    ["await", "kw"],
    [" sandbox.harness.", "plain"],
    ["start", "fn"],
    ["(", "plain"],
    ["promptFor", "fn"],
    ["(issue))", "plain"],
  ],
  [["", "plain"]],
  [
    ["for await", "kw"],
    [" (", "plain"],
    ["const", "kw"],
    [" event ", "plain"],
    ["of", "kw"],
    [" run.record.", "plain"],
    ["stream", "fn"],
    ["()) {", "plain"],
  ],
  [
    ["  board.", "plain"],
    ["update", "fn"],
    ["(issue, event)", "plain"],
  ],
  [["}", "plain"]],
  [["", "plain"]],
  [
    ["await", "kw"],
    [" run.", "plain"],
    ["wait", "fn"],
    ["()", "plain"],
  ],
  [
    ["const", "kw"],
    [" pr = ", "plain"],
    ["await", "kw"],
    [" github.", "plain"],
    ["openPullRequest", "fn"],
    ["(run.changes, run.record)", "plain"],
  ],
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
              eyebrow={<Eyebrow>The evidence</Eyebrow>}
              title="The record is written by the runtime, not the model."
              intro={
                <p>
                  Every Mend job runs on{" "}
                  <a
                    href={PLATFORM_SITE_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="text-foreground underline decoration-[var(--sw-rule)] underline-offset-4 hover:decoration-[var(--sw-accent)]"
                  >
                    Sealant
                  </a>
                  , an open-source runtime that puts the harness in an isolated sandbox and records
                  the run from underneath it: processes, exits, file changes, command output,
                  network. The harness can't embellish a record it doesn't write.
                </p>
              }
            />
            <Reveal className="mt-10 space-y-7">
              <div>
                <h3 className="font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
                  Provenance on every event
                </h3>
                <p className="mt-2 max-w-[52ch] leading-relaxed text-muted-foreground">
                  <span className="text-success">Observed</span> means the runtime saw it happen.{" "}
                  <span className="text-warning">Inferred</span> means the harness claimed it. The
                  two are never blurred, in the record or in the UI.
                </p>
              </div>
              <div>
                <h3 className="font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
                  The record outlives the sandbox
                </h3>
                <p className="mt-2 max-w-[52ch] leading-relaxed text-muted-foreground">
                  The run is a durable event log, not a terminal scrollback. Replay it step by step
                  during review, or a month later when someone asks why the change was made.
                </p>
              </div>
              <div>
                <h3 className="font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
                  Observations, not verdicts
                </h3>
                <p className="mt-2 max-w-[52ch] leading-relaxed text-muted-foreground">
                  Mend reports what happened and stops there. No confidence scores, no "safe to
                  merge". You decide what merges — with the evidence in front of you.
                </p>
              </div>
            </Reveal>
          </div>

          <Reveal className="min-w-0 lg:pt-10">
            <CatalogEyebrow runId="mnd_4c7t" events="212" className="mb-3 block" />
            <RunRecord
              runId="run mnd_4c7t"
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
              footnote="pull_request.opened · #221 · mend/invoice-rounding"
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
              npm. Create a sandbox around the issue's repository, start the harness, stream the
              record onto the board, open the PR from the settled changes.
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

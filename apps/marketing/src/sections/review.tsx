// REVIEW — the payoff. A Mend PR arrives like a teammate's: the change plus
// how it was made. The section pairs the claim with the signature run-record
// panel: evidence rows with provenance dots, the diff beside its record.

import { Eyebrow, Reveal, SectionHead } from "#/components/primitives";
import { CatalogEyebrow, RunRecord } from "#/components/run-record";

const POINTS: ReadonlyArray<readonly [string, string]> = [
  [
    "The diff beside its record",
    "Every changed file sits next to the events that produced it — no guessing what the harness did between commits.",
  ],
  [
    "Commands and checks, observed",
    "What ran, what exited with what code, what the tests said. Dot + word, straight from the record.",
  ],
  [
    "Replay, don't re-run",
    "The run is a durable record. Step through it after the sandbox is gone, and share it with the review.",
  ],
];

export function Review() {
  return (
    <section id="review" className="bg-[var(--sw-bg)] py-24 lg:py-32">
      <div className="mx-auto w-full max-w-[1200px] px-6 sm:px-8">
        <div className="grid items-start gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="min-w-0">
            <SectionHead
              eyebrow={<Eyebrow>Review the evidence</Eyebrow>}
              title="Review it like a teammate's work."
              intro={
                <p>
                  A Mend pull request doesn't ask you to trust an agent. It arrives with how it was
                  made: the commands that ran, the checks that were observed, and the full record of
                  the run.{" "}
                  <span className="text-foreground">
                    Mend reports what happened; you decide what merges.
                  </span>
                </p>
              }
            />
            <Reveal className="mt-10 space-y-7">
              {POINTS.map(([title, body]) => (
                <div key={title}>
                  <h3 className="font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
                    {title}
                  </h3>
                  <p className="mt-2 max-w-[52ch] leading-relaxed text-muted-foreground">{body}</p>
                </div>
              ))}
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
      </div>
    </section>
  );
}

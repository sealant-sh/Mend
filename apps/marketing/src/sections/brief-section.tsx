// THE BRIEF — the core section: the review Mend performed, walked part by
// part beside the full exhibit. This is what the recording is FOR.

import { Brief } from "#/components/brief";
import { Container, Eyebrow, Reveal, SectionHead } from "#/components/primitives";

const PARTS: ReadonlyArray<readonly [string, string]> = [
  [
    "Proof, not green checks",
    "base fails · head passes · revert fails — the recorded run shows the bug existed, the fix removes it, and reverting brings it back. A green pipeline claims none of that.",
  ],
  [
    "Questions, not a wall of text",
    "The review is decomposed into the questions a reviewer would ask. Each is answered with direct evidence from the recording, or labeled: not executed, unrelated change.",
  ],
  [
    "Gaps are content",
    "What was never run is stated in amber at the top, not buried. The half-cent scenario above wasn't tested — the brief says so before you ask.",
  ],
  [
    "Approving merges",
    "By default every successful run opens a draft PR with the brief in its description. Approve in Mend and it merges on GitHub, respecting branch protection. If base moves first, the brief flips to evidence stale and re-verifies on request.",
  ],
];

export function BriefSection() {
  return (
    <section id="review" className="bg-[var(--sw-bg)] py-24 lg:py-32">
      <Container>
        <SectionHead
          eyebrow={<Eyebrow>The brief</Eyebrow>}
          title="The review arrives done."
          intro={
            <p>
              When a run finishes, Mend reviews the change against the recording and compiles the
              result into the brief: what holds, what was never run, what doesn't belong to the
              issue. It's posted into the draft PR and lives in full in Mend.
            </p>
          }
        />
        <Reveal className="mt-12">
          <Brief variant="full" illustrative />
        </Reveal>
        <Reveal className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2">
          {PARTS.map(([title, body]) => (
            <div key={title}>
              <h3 className="font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
                {title}
              </h3>
              <p className="mt-2.5 max-w-[52ch] leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </Reveal>
      </Container>
    </section>
  );
}

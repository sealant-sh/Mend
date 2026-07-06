// SOURCES — the run audit's source trail: every source the agent opened,
// how it was treated, and what was taken from it. Contradicted and discarded
// sources stay on the record.

import { Container, Eyebrow, Reveal, SectionHead } from "#/components/primitives";
import { SourceTrail } from "#/components/source-trail";

export function Sources() {
  return (
    <section id="sources" className="bg-[var(--sw-canvas)] py-24 lg:py-32">
      <Container>
        <SectionHead
          eyebrow={<Eyebrow>The source trail</Eyebrow>}
          title="Where every idea came from."
          intro={
            <p>
              Behind the brief sits the run audit: the full trace, and every source the agent opened
              — why it was opened, what was taken from it, and how it was treated. Sources that
              contradicted the approach, and ones that were tried and discarded, stay on the record
              alongside the ones relied on.
            </p>
          }
        />
        <Reveal className="mt-12">
          <SourceTrail illustrative />
        </Reveal>
        <Reveal className="mt-8">
          <p className="max-w-[68ch] leading-relaxed text-muted-foreground">
            Provenance is tracked per source:{" "}
            <span className="font-mono text-[0.85em] text-foreground">reference only</span>,{" "}
            <span className="font-mono text-[0.85em] text-foreground">no code copied</span>, the
            license, and an archived snapshot of what the agent actually saw — so a claim in the
            brief can be traced to its origin months after the run.
          </p>
        </Reveal>
      </Container>
    </section>
  );
}

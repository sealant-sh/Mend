// The loop strip — a thin full-width band, not a section. The whole loop on
// one line, and the queue stages it moves through underneath. No record, no pills.

import { ArrowRight } from "lucide-react";

import { Container, Reveal } from "#/components/primitives";

const STEPS = [
  "File an issue",
  "A harness mends it",
  "Review the evidence",
  "Merge the PR",
] as const;

export function LoopStrip() {
  return (
    <section id="loop" className="border-y border-border bg-panel">
      <Container className="py-12">
        <Reveal className="mx-auto max-w-[72ch] text-center">
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
            {STEPS.map((step, i) => (
              <span key={step} className="inline-flex items-center gap-3">
                <span className="text-base font-medium text-foreground sm:text-lg">{step}</span>
                {i < STEPS.length - 1 ? (
                  <ArrowRight className="size-4 text-primary" aria-hidden="true" />
                ) : null}
              </span>
            ))}
          </div>
          <p className="mt-5 font-mono text-xs text-faint">
            triage → queued → mending → review → PR opened
          </p>
        </Reveal>
      </Container>
    </section>
  );
}

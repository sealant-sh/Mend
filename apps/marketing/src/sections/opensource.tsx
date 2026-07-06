// OPEN-SOURCE & SELF-HOSTED — plain facts: where it runs, what it costs,
// what it refuses to do. Three cards in the page's card idiom.

import { Code2, ScanEye, ServerCog } from "lucide-react";

import {
  CloneCommand,
  Container,
  Eyebrow,
  type IconType,
  Reveal,
  SectionHead,
} from "#/components/primitives";

interface Pillar {
  readonly icon: IconType;
  readonly title: string;
  readonly body: string;
}

const PILLARS: ReadonlyArray<Pillar> = [
  {
    icon: Code2,
    title: "Open source",
    body: "Apache-2.0, one repo. You can read every line of the thing that touches your issues and opens PRs in your name.",
  },
  {
    icon: ServerCog,
    title: "Self-hosted",
    body: "Runs against your own GitHub and your own Sealant instance. No hosted service, no account, nothing phoning home.",
  },
  {
    icon: ScanEye,
    title: "Observations, not verdicts",
    body: "No scores, no “safe to merge”. Mend shows what the runtime observed and leaves the merge decision where it belongs.",
  },
];

export function OpenSource() {
  return (
    <section id="open-source" className="bg-panel py-24 lg:py-32">
      <Container>
        <SectionHead
          eyebrow={<Eyebrow>Open-source and self-hosted</Eyebrow>}
          title="Nothing leaves your infrastructure."
          intro={
            <p>
              Your code, your runs, and your credentials stay on machines you control. Mend talks to
              your GitHub and your Sealant instance and nowhere else.
            </p>
          }
        />
        <Reveal className="mx-auto mt-10 flex max-w-2xl flex-col items-center gap-3">
          <CloneCommand />
        </Reveal>
        <Reveal className="mt-12 grid gap-5 sm:grid-cols-3">
          {PILLARS.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <div
                key={pillar.title}
                className="rounded-2xl border border-border bg-background p-6 shadow-[var(--shadow-xs)]"
              >
                <span className="inline-flex size-9 items-center justify-center rounded-lg bg-[var(--sw-wash)] text-primary">
                  <Icon className="size-4" />
                </span>
                <h3 className="mt-4 font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
                  {pillar.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{pillar.body}</p>
              </div>
            );
          })}
        </Reveal>
      </Container>
    </section>
  );
}

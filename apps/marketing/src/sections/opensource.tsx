// OPEN-SOURCE & LOCAL-FIRST — plain facts: where it runs, where the code
// lives, what it refuses to do. Three cards in the page's card idiom.

import { Code2, HardDrive, ScanEye } from "lucide-react";

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
    body: "Apache-2.0, one repo. You can read every line of the thing that runs your agents, holds your repositories, and talks to your phone.",
  },
  {
    icon: HardDrive,
    title: "Local-first, self-hosted",
    body: "The store is a directory on your Mend host; sessions run there under your control. Remote access uses your own LAN or tailnet — no Mend cloud, no Mend account, no public repository required.",
  },
  {
    icon: ScanEye,
    title: "Observations, not verdicts",
    body: "No scores, no “safe to merge”. Mend shows what the runtime observed — what ran, what didn't, what has no recorded cause — and leaves the decision where it belongs.",
  },
];

export function OpenSource() {
  return (
    <section id="open-source" className="bg-[var(--sw-canvas)] py-24 lg:py-32">
      <Container>
        <SectionHead
          eyebrow={<Eyebrow>Open-source and local-first</Eyebrow>}
          title="Mend has no cloud to send it to."
          intro={
            <p>
              Your repositories, session state, and review record stay on hardware you control. The
              agent you choose still talks to its provider as usual; Mend adds no hosted service or
              telemetry in between, and remote access does not require a public port.
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

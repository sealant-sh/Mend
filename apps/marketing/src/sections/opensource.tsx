// OPEN-SOURCE & SELF-HOSTED — positive framing: your issues, your repos, your
// infrastructure. Three cards in the page's card idiom, plus the honest ask.

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
    body: "Apache-2.0, its own standalone repo. Read every line of the thing that touches your issues and your PRs.",
  },
  {
    icon: ServerCog,
    title: "Self-hosted",
    body: "Mend runs against your own Sealant. Your code and your runs stay in your infrastructure — nothing leaves.",
  },
  {
    icon: ScanEye,
    title: "Evidence, not verdicts",
    body: "No scores, no “safe to merge.” Mend shows what it observed and lets the reviewer decide.",
  },
];

export function OpenSource() {
  return (
    <section id="open-source" className="bg-[var(--sw-bg)] py-24 lg:py-32">
      <Container>
        <SectionHead
          eyebrow={<Eyebrow>Open-source and self-hosted</Eyebrow>}
          title="Run it where your issues already live."
          intro={
            <p>
              Mend is an open-source product by Sealant — a focused workflow on top of the platform,
              standing on its own. Point it at your repositories, connect the harnesses you already
              trust, and keep every run.
            </p>
          }
        />
        <Reveal className="mx-auto mt-10 flex max-w-2xl flex-col items-center gap-3">
          <CloneCommand />
          <p className="text-center font-mono text-xs text-faint">
            Building now — star the repo to follow the first mended PRs.
          </p>
        </Reveal>
        <Reveal className="mt-12 grid gap-5 sm:grid-cols-3">
          {PILLARS.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <div
                key={pillar.title}
                className="rounded-2xl border border-border bg-panel p-6 shadow-[var(--shadow-xs)]"
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

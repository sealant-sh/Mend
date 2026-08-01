// The closer — where the software actually lives, and the one ask. Plain
// facts on the sheet, no billboard card.

import { GitHubLogo } from "#/components/github";
import {
  CloneCommand,
  Container,
  Display,
  Eyebrow,
  PLATFORM_SITE_URL,
  PrimaryCTA,
  REPO_URL,
  Reveal,
  SecondaryCTA,
  TrustLine,
} from "#/components/primitives";

const FACTS: ReadonlyArray<readonly [string, string]> = [
  [
    "Open source",
    "Apache-2.0, one repository. You can read every line of the thing that runs your agents, holds your repositories, and talks to your phone.",
  ],
  [
    "Local-first",
    "The store is a directory on your Mend host; sessions run there under your control. No Mend cloud, no Mend account, no telemetry. The agent you bring still talks to its own provider, as it does today.",
  ],
  [
    "Private by construction",
    "Remote access rides your own LAN or tailnet. Nothing requires a public port, a hosted relay, or a public repository.",
  ],
];

export function FinalCta() {
  return (
    <section id="start" className="bg-[var(--sw-bg)] py-24 lg:py-32">
      <Container>
        <div className="mx-auto max-w-3xl text-center">
          <Reveal>
            <Eyebrow>Start</Eyebrow>
            <Display className="mx-auto mt-5 max-w-[24ch] text-[2.1rem] sm:text-5xl">
              Clone it and point it at a repository.
            </Display>
            <p className="mx-auto mt-5 max-w-[52ch] text-lg leading-relaxed text-muted-foreground">
              Mend is early and in development. The loop on this page — adopt, run your agent,
              detach, reattach, review, follow up — works today; the section above lists what
              doesn't yet.
            </p>
          </Reveal>
          <Reveal className="mt-9 flex flex-col items-center gap-5">
            <CloneCommand />
            <div className="flex flex-wrap items-center justify-center gap-3">
              <PrimaryCTA href={REPO_URL}>
                <GitHubLogo className="size-4" />
                View the repository
              </PrimaryCTA>
              <SecondaryCTA href={PLATFORM_SITE_URL}>The runtime underneath</SecondaryCTA>
            </div>
            <TrustLine />
          </Reveal>
        </div>

        <Reveal className="mx-auto mt-16 grid max-w-5xl gap-x-8 gap-y-10 text-left sm:grid-cols-3">
          {FACTS.map(([title, body]) => (
            <div key={title}>
              <h3 className="font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
                {title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </Reveal>
      </Container>
    </section>
  );
}

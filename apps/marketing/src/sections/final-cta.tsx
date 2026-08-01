// The closer — one plain ask. The page ends on a quiet inert record whose
// session has not started: honest to the day-one status.

import { GitHubLogo } from "#/components/github";
import {
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
import { RunRecord } from "#/components/run-record";

export function FinalCta() {
  return (
    <section id="start" className="bg-[var(--sw-bg)] py-24 lg:py-32">
      <Container>
        <Reveal>
          <div className="mx-auto max-w-3xl rounded-[2.25rem] border border-border bg-panel px-8 py-16 text-center shadow-[var(--shadow-md)] sm:px-12 lg:py-24">
            <Eyebrow>Built in the open</Eyebrow>
            <Display className="mx-auto mt-5 max-w-[26ch] text-[2.1rem] sm:text-5xl lg:text-[3.25rem]">
              Early, and building in public.
            </Display>
            <p className="mx-auto mt-5 max-w-[52ch] text-lg leading-relaxed text-muted-foreground">
              The core loop is already real: adopt a repository, run or reattach to your agent,
              inspect and comment on its worktree, then carry the follow-up back into the same
              session. Do it from another computer or your phone. Browser services, one-click review
              delivery, and record-grounded machine review are next.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <PrimaryCTA href={REPO_URL}>
                <GitHubLogo className="size-4" />
                Star on GitHub
              </PrimaryCTA>
              <SecondaryCTA href={PLATFORM_SITE_URL}>The runtime underneath</SecondaryCTA>
            </div>
            <TrustLine className="mt-7" />
            <RunRecord
              variant="inert"
              runId="session 01J00000"
              status={{ word: "Not started", tone: "pending" }}
              events={[]}
              footnote="no sessions yet · your first lands here"
              className="mx-auto mt-10 max-w-md text-left"
            />
          </div>
        </Reveal>
      </Container>
    </section>
  );
}

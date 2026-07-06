// WHY — the problem, stated for someone who has merged (or refused to merge)
// agent PRs. Three facts, each checkable against the reader's own experience.

import { Container, Eyebrow, Reveal, SectionHead } from "#/components/primitives";

const PROBLEMS: ReadonlyArray<readonly [string, string]> = [
  [
    "The summary reviews itself",
    "The description on an agent PR is written by the model that made the change. If it missed something, its summary misses it too.",
  ],
  [
    "The workspace is gone",
    "By review time, the environment that produced the change has been torn down. What ran, what failed first, what else was touched — unrecoverable.",
  ],
  [
    "So the diff is all you get",
    "Agent PRs merge unread, or queue until they rot. Reviewing one properly means re-deriving the work yourself, which is the job the agent was supposed to remove.",
  ],
];

export function Why() {
  return (
    <section id="why" className="bg-panel py-24 lg:py-32">
      <Container>
        <SectionHead
          eyebrow={<Eyebrow>Why</Eyebrow>}
          title="Nobody reads the code anymore. Something has to."
          intro={
            <p>
              Agent tooling optimized writing the change. Deciding whether to merge it is still your
              problem — and everything you'd need to decide with disappears when the agent's
              workspace does.
            </p>
          }
        />
        <Reveal className="mt-12 grid gap-10 sm:grid-cols-3 sm:gap-8">
          {PROBLEMS.map(([title, body]) => (
            <div key={title}>
              <h3 className="font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
                {title}
              </h3>
              <p className="mt-2.5 leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </Reveal>
      </Container>
    </section>
  );
}

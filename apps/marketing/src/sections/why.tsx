// WHY — the problem, stated plainly for developers who have reviewed agent
// output before. No drama: three concrete reasons the current workflow
// doesn't hold up, each one testable against the reader's own experience.

import { Container, Eyebrow, Reveal, SectionHead } from "#/components/primitives";

const PROBLEMS: ReadonlyArray<readonly [string, string]> = [
  [
    "The summary is self-reported",
    "The model that made the change also wrote the description of what it did. If it missed something, the summary misses it too. That isn't evidence — it's the work under review describing itself.",
  ],
  [
    "The environment is gone",
    "By the time you review, the workspace that produced the change has been torn down. You can't check what ran, what failed on the first attempt, or what else was touched along the way.",
  ],
  [
    "So review becomes re-work",
    "You either re-derive the change yourself — check out the branch, run the tests, retrace the reasoning — or you approve on trust. Neither scales past small PRs.",
  ],
];

export function Why() {
  return (
    <section id="why" className="bg-[var(--sw-bg)] py-24 lg:py-32">
      <Container>
        <SectionHead
          eyebrow={<Eyebrow>Why</Eyebrow>}
          title="A diff and a summary isn't a review."
          intro={
            <p>
              Agent tooling today hands you a diff, a green check, and a description written by the
              model itself. Everything between the prompt and the pull request happened somewhere
              you can't see, in an environment that no longer exists.
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

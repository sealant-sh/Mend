// THE REVIEW — the core section: the session's worktree as a first-class
// reviewable change, walked part by part beside the full exhibit. This is
// what the recording is FOR.

import { ChangeReview } from "#/components/change-review";
import { Container, Eyebrow, Reveal, SectionHead } from "#/components/primitives";

const PARTS: ReadonlyArray<readonly [string, string]> = [
  [
    "Comments become an editable follow-up",
    "Mend assembles the open comments into one editable instruction and saves it to the same session. Today, mend continue delivers the bundle and reopens the work; one-click delivery from the review is next.",
  ],
  [
    "The change already belongs to one session",
    "Every write happens in that session's supervised worktree, so the change-to-session link is structural rather than guessed. Hunk-level prompts, commands, and checks are the next layer of the review.",
  ],
  [
    "Landing is optional",
    "Commit, merge, or open a PR when the review holds — or don't. Publication is one possible output of a change, not the price of getting a review.",
  ],
];

export function Review() {
  return (
    <section id="review" className="bg-[var(--sw-bg)] py-24 lg:py-32">
      <Container>
        <SectionHead
          eyebrow={<Eyebrow>The review</Eyebrow>}
          title="Review the change before it's a commit."
          intro={
            <p>
              Each session exposes one change: its worktree against its base. That is a first-class
              review object in Mend — a proper diff viewer, line-range comments, and a direct path
              back to the session that produced it. No branch to push, no PR to open, nothing to
              clean up first.
            </p>
          }
        />
        <Reveal className="mt-12">
          <ChangeReview illustrative />
        </Reveal>
        <Reveal className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-3">
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

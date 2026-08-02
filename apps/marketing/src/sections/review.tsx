// THE REVIEW — the session's worktree as a reviewable change, with Mend
// reviewing alongside: draft comments and suggested fixes backed by the
// session record.

import { ChangeReview } from "#/components/change-review";
import { Container, Eyebrow, Reveal, SectionHead } from "#/components/primitives";

const PARTS: ReadonlyArray<readonly [string, string]> = [
  [
    "Mend reviews with you",
    "Mend reads the change against the session record and leaves draft comments with suggested fixes — each one tied to what actually ran, with a check you can execute. It runs on your server with your subscription, so nothing leaves your infra.",
  ],
  [
    "Comments become a follow-up",
    "Open comments are assembled into one editable instruction and saved to the session. mend continue delivers the bundle and reopens the work.",
  ],
  [
    "Merge on your terms",
    "Commit, merge, or open a PR when the review holds — or keep the change local. Reviewing doesn't require pushing a branch anywhere.",
  ],
];

export function Review() {
  return (
    <section id="review" className="bg-[var(--sw-bg)] py-24 lg:py-32">
      <Container>
        <SectionHead
          eyebrow={<Eyebrow>Review</Eyebrow>}
          title="Review the change before it's a commit."
          intro={
            <p>
              Each session exposes one change: its worktree against its base. Mend gives it a proper
              diff viewer with line-range comments and a direct path back to the session that
              produced it — and reviews the change itself, right there on your server.
            </p>
          }
        />
        <Reveal className="mt-12">
          <ChangeReview />
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

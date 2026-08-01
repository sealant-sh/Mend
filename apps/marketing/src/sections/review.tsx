// THE REVIEW — the core section: the session's worktree as a first-class
// reviewable change, walked part by part beside the full exhibit. This is
// what the recording is FOR.

import { ChangeReview } from "#/components/change-review";
import {
  AvailableNow,
  BuildingNow,
  Container,
  Eyebrow,
  Reveal,
  SectionHead,
} from "#/components/primitives";

const PARTS: ReadonlyArray<{
  readonly title: string;
  readonly body: string;
  readonly status: "available" | "building";
}> = [
  {
    title: "Comments become an editable follow-up",
    body: "Mend assembles the open comments into one editable instruction and saves it to the same session. Today, mend continue delivers the bundle and reopens the work; one-click delivery from the review is next.",
    status: "available",
  },
  {
    title: "The change already belongs to one session",
    body: "Every write happens in that session's supervised worktree, so the change-to-session link is structural rather than guessed. Hunk-level prompts, commands, and checks are the next layer of the review.",
    status: "available",
  },
  {
    title: "Mend reads the change",
    body: "The planned machine pass reads the record, not just the patch: instruction drift, rewrites nothing exercised, context supplied but never read. Every draft finding must link to the record or ship with a runnable check.",
    status: "building",
  },
  {
    title: "Landing is optional",
    body: "Commit, merge, or open a PR when the review holds — or don't. Publication is one possible output of a change, not the price of getting a review.",
    status: "available",
  },
];

function CapabilityStatus({ status }: { readonly status: "available" | "building" }) {
  return status === "available" ? (
    <AvailableNow className="mt-2" />
  ) : (
    <BuildingNow className="mt-2" />
  );
}

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
        <Reveal className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2">
          {PARTS.map((part) => (
            <div key={part.title}>
              <h3 className="font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
                {part.title}
              </h3>
              <CapabilityStatus status={part.status} />
              <p className="mt-2.5 max-w-[52ch] leading-relaxed text-muted-foreground">
                {part.body}
              </p>
            </div>
          ))}
        </Reveal>
      </Container>
    </section>
  );
}

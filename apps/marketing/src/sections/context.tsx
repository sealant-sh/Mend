// CONTEXT — explicit, inspectable, versioned. The exhibit is a context pack
// with its immutable per-session snapshot; the copy carries handoffs and the
// no-hidden-memory stance.

import { BuildingNow, Container, Eyebrow, Reveal, SectionHead } from "#/components/primitives";

const ITEMS: ReadonlyArray<{
  kind: string;
  title: string;
  meta: string;
}> = [
  { kind: "File", title: "AGENTS.md", meta: "repo · digest 4c1f9ae" },
  { kind: "Doc", title: "docs/authentication.md", meta: "repo · updated 3 days ago" },
  {
    kind: "Note",
    title: "Decision — database sessions remain authoritative",
    meta: "promoted from session 01J6RT2C",
  },
  {
    kind: "Handoff",
    title: "Handoff — legacy callback investigation",
    meta: "session 01J7Q2XN · edited by you",
  },
  { kind: "Link", title: "Provider docs — session cookies", meta: "archived snapshot" },
];

function KindLabel({ kind }: { kind: string }) {
  return <span className="w-12 shrink-0 pt-0.5 font-mono text-[0.6rem] text-faint">{kind}</span>;
}

function ContextPack() {
  return (
    <figure className="min-w-0">
      <div className="overflow-hidden rounded-2xl border border-border bg-panel shadow-[var(--shadow-md)]">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-rule bg-[var(--sw-sunken)] px-5 py-3">
          <span className="min-w-0 truncate font-mono text-[0.72rem] text-ink-2">
            Context pack <span className="text-faint">·</span> Authentication service
          </span>
          <span className="font-mono text-[0.68rem] text-faint">v12 · 5 items</span>
        </div>
        <div>
          {ITEMS.map((item) => (
            <div
              key={item.title}
              className="flex items-start gap-3 border-b border-rule-faint px-5 py-2.5 last:border-b-0"
            >
              <KindLabel kind={item.kind} />
              <div className="min-w-0">
                <p className="truncate text-[0.82rem] font-medium text-foreground">{item.title}</p>
                <p className="mt-0.5 truncate font-mono text-[0.66rem] text-faint">{item.meta}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule px-5 py-2.5">
          <span className="font-mono text-[0.68rem] text-muted-foreground">
            session 01J8QK4M received snapshot v12 · immutable
          </span>
          <span className="font-mono text-[0.68rem] text-primary">Shown beside its review</span>
        </div>
      </div>
      <figcaption className="mt-3 text-center font-mono text-[0.62rem] tracking-[0.04em] text-faint uppercase">
        Illustrative context pack — planned
      </figcaption>
    </figure>
  );
}

export function ContextSection() {
  return (
    <section id="context" className="bg-panel py-24 lg:py-32">
      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:gap-16">
          <div className="min-w-0">
            <SectionHead
              eyebrow={<Eyebrow>Context</Eyebrow>}
              title="Sessions should stop starting from zero."
              intro={
                <p>
                  Mend will keep context explicit: files, docs, notes, decisions, and previous
                  handoffs grouped into named packs. Each session will receive an immutable snapshot
                  so "what did the agent know?" has an exact answer.
                </p>
              }
            />
            <Reveal className="mt-6">
              <BuildingNow word="Planned" />
            </Reveal>
            <Reveal className="mt-10 space-y-7">
              <div>
                <h3 className="font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
                  Handoffs instead of re-explaining
                </h3>
                <p className="mt-2 max-w-[52ch] leading-relaxed text-muted-foreground">
                  A settled session will draft a handoff — the goal, the decisions, what changed,
                  and what's still open. Edit it, save it, and let the next session start there
                  instead of reconstructing the work from memory.
                </p>
              </div>
              <div>
                <h3 className="font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
                  Explicit beats magical
                </h3>
                <p className="mt-2 max-w-[52ch] leading-relaxed text-muted-foreground">
                  No hidden memory and no vector store quietly deciding what matters. You will be
                  able to read everything a session received, and the review will show the exact
                  snapshot — including a document that was supplied but never read.
                </p>
              </div>
            </Reveal>
          </div>
          <Reveal className="min-w-0 lg:pt-8">
            <ContextPack />
          </Reveal>
        </div>
      </Container>
    </section>
  );
}

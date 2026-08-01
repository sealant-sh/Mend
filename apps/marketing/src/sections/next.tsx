// WHAT'S NEXT — the roadmap, stated once and plainly. Planned work lives here
// instead of masquerading as feature sections with mocked-up screenshots.

import { BuildingNow, Container, Eyebrow, Reveal, SectionHead } from "#/components/primitives";

const PLANNED: ReadonlyArray<readonly [string, string]> = [
  [
    "A browser surface for dev servers",
    "When a session starts a development server, Mend will expose it on the session's private URL — reachable from your other devices over the same authenticated connection, without turning the workspace into a public deployment.",
  ],
  [
    "Context packs and handoffs",
    "Named, versioned selections of files, docs, and decisions. Each session receives an immutable snapshot, so “what did the agent know?” has an exact answer — and a settled session drafts a handoff you can edit and pass to the next one.",
  ],
  [
    "Mend reads the change",
    "A machine pass over the record, not just the patch: instruction drift, rewrites nothing exercised, context supplied but never read. Draft comments and proposed checks, each linked to the record or shipped with a runnable check. Never verdicts.",
  ],
  [
    "Scoped device access",
    "QR pairing and revocable per-device tokens, replacing the single operator token before the remote setup is called finished.",
  ],
];

export function WhatsNext() {
  return (
    <section id="next" className="bg-[var(--sw-canvas)] py-24 lg:py-32">
      <Container>
        <SectionHead
          eyebrow={<Eyebrow>Roadmap</Eyebrow>}
          title="What isn't built yet."
          intro={
            <p>
              Everything above this line runs in the development build today. The pieces below are
              designed but not shipped.
            </p>
          }
        />
        <Reveal className="mt-6">
          <BuildingNow word="In development" />
        </Reveal>

        <Reveal className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2">
          {PLANNED.map(([title, body]) => (
            <div key={title}>
              <h3 className="font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
                {title}
              </h3>
              <p className="mt-2 max-w-[52ch] leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </Reveal>
      </Container>
    </section>
  );
}

// DEV SERVERS — the answer to port roulette. Designed (per-port forwards over
// the private network, discovered by observation), not shipped: stated plainly
// with the building-now badge and deliberately no mockup.

import { BuildingNow, Container, Eyebrow, Reveal, SectionHead } from "#/components/primitives";

const FACTS: ReadonlyArray<readonly [string, string]> = [
  [
    "Discovered, not configured",
    "The workspace reports when something starts or stops listening. Mend forwards the port and labels it with the session that owns it; an explicit declaration is there for when detection isn't enough.",
  ],
  [
    "Another view of the session",
    "The forwarded URL belongs to the session, like its terminal and its diff. Open it from the machine you're on — or your phone — and it goes away when the session does.",
  ],
  [
    "Never public",
    "Forwards bind to your LAN or tailnet, on the same authenticated connection as everything else. No public port, no tunnel service, no accidental deployment.",
  ],
];

export function Servers() {
  return (
    <section id="servers" className="bg-panel py-24 lg:py-32">
      <Container>
        <SectionHead
          eyebrow={<Eyebrow>Dev servers</Eyebrow>}
          title="The dev server belongs to the session too."
          intro={
            <p>
              Run three sessions and you get three dev servers on three ports nobody remembers. When
              a server starts listening inside a session's workspace, Mend will forward it and show
              it beside the session it belongs to — no port map in your head, no guessing which{" "}
              <code className="font-mono text-[0.85em] text-foreground">:3000</code> is whose.
            </p>
          }
        />
        <Reveal className="mt-6">
          <BuildingNow word="In development" />
        </Reveal>

        <Reveal className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-3">
          {FACTS.map(([title, body]) => (
            <div key={title}>
              <h3 className="font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
                {title}
              </h3>
              <p className="mt-2 leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </Reveal>
      </Container>
    </section>
  );
}

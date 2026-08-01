// THE RUNNING APP — planned first-class browser access to services inside a
// session workspace. It extends the ownership thesis: the code, conversation,
// terminal, and dev server are all views of the same durable session.

import { BuildingNow, Container, Eyebrow, Reveal, SectionHead } from "#/components/primitives";

const INVOICE_ROWS: ReadonlyArray<readonly [string, string]> = [
  ["Customer", "Acme Europe"],
  ["Discount", "€12.40"],
  ["Rounding", "half-even · €0.02"],
];

function BrowserPreview() {
  return (
    <figure className="min-w-0">
      <div className="overflow-hidden rounded-3xl border border-border bg-panel shadow-[var(--shadow-lg)]">
        <div className="flex items-center gap-3 border-b border-rule bg-[var(--sw-sunken)] px-4 py-3">
          <div className="flex shrink-0 items-center gap-1.5" aria-hidden="true">
            <span className="size-2 rounded-full bg-[var(--sw-rule)]" />
            <span className="size-2 rounded-full bg-[var(--sw-rule)]" />
            <span className="size-2 rounded-full bg-[var(--sw-rule)]" />
          </div>
          <div className="min-w-0 flex-1 rounded-lg border border-rule bg-background px-3 py-1.5 font-mono text-[0.68rem] text-muted-foreground">
            <span className="text-success">private</span>
            <span className="text-faint"> · </span>
            mend.local/session/01J8QK4M/3000
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule-faint px-5 py-3">
          <div>
            <p className="font-sans text-[0.82rem] font-medium text-foreground">billing-service</p>
            <p className="mt-0.5 font-mono text-[0.64rem] text-faint">
              session 01J8QK4M · worktree service
            </p>
          </div>
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-[var(--sw-green-dot)]" aria-hidden="true" />
            <span className="font-mono text-[0.66rem] text-success">localhost:3000 · detected</span>
          </span>
        </div>

        <div className="bg-background p-5 sm:p-7">
          <div className="rounded-2xl border border-border bg-panel p-5 shadow-[var(--shadow-sm)]">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <p className="ev-eyebrow">Invoice</p>
                <h3 className="mt-2 font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
                  INV-2048
                </h3>
              </div>
              <p className="font-mono text-xl text-foreground">€118.42</p>
            </div>
            <dl className="mt-5 border-t border-rule-faint pt-2">
              {INVOICE_ROWS.map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-4 border-b border-rule-faint py-2 last:border-b-0"
                >
                  <dt className="text-[0.78rem] text-muted-foreground">{label}</dt>
                  <dd className="font-mono text-[0.72rem] text-ink-2">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule px-5 py-3">
          <span className="font-mono text-[0.68rem] text-muted-foreground">
            pnpm dev · process still running in the session
          </span>
          <span className="font-sans text-[0.78rem] font-medium text-primary">
            Open in browser →
          </span>
        </div>
      </div>
      <figcaption className="mt-3 text-center font-mono text-[0.62rem] tracking-[0.04em] text-faint uppercase">
        Illustrative session service — planned
      </figcaption>
    </figure>
  );
}

const POINTS: ReadonlyArray<readonly [string, string]> = [
  [
    "Start it normally",
    "Run the repository's own dev command. Mend will surface the service on the session instead of making you remember container ports or build a forwarding setup.",
  ],
  [
    "Open the exact work in progress",
    "The browser reaches the server running against that session's worktree. Refresh after an agent edit and you see the same code you are about to review.",
  ],
  [
    "Keep the private boundary",
    "The service follows Mend's authenticated, private connection. It is available to your devices without becoming a public deployment.",
  ],
];

export function BrowserSection() {
  return (
    <section id="browser" className="bg-panel py-24 lg:py-32">
      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)] lg:gap-16">
          <div className="min-w-0">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <SectionHead
                eyebrow={<Eyebrow>The running app</Eyebrow>}
                title="The dev server belongs to the session too."
                intro={
                  <p>
                    First-class browser access is next: when a session starts a development server,
                    Mend will give it a direct browser surface. Open it from another laptop or your
                    phone without moving the work or exposing the workspace publicly.
                  </p>
                }
              />
              <Reveal className="pb-1">
                <BuildingNow word="Planned" />
              </Reveal>
            </div>
            <Reveal className="mt-10 space-y-7">
              {POINTS.map(([title, body]) => (
                <div key={title}>
                  <h3 className="font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
                    {title}
                  </h3>
                  <p className="mt-2 max-w-[52ch] leading-relaxed text-muted-foreground">{body}</p>
                </div>
              ))}
            </Reveal>
          </div>
          <Reveal className="min-w-0 lg:pt-8">
            <BrowserPreview />
          </Reveal>
        </div>
      </Container>
    </section>
  );
}

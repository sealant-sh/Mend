// THE PAGE — one screen, no pitch. The claim, the five capabilities, how the
// pieces fit, and the install line. Content lives in components/content.tsx,
// shared with the denser /2 variant; if a sentence doesn't earn its height it
// goes.

import { createFileRoute } from "@tanstack/react-router";

import {
  FEATURES,
  HEADLINE,
  HOW_IT_WORKS,
  InstallCommand,
  PageHeader,
  SUBLINE,
  TRUST_LINE,
} from "#/components/content";

export const Route = createFileRoute("/")({
  component: MarketingPage,
});

function MarketingPage() {
  return (
    <main className="relative flex min-h-dvh flex-col overflow-x-clip bg-[var(--sw-canvas)]">
      <div
        className="mend-dot-grid pointer-events-none absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_at_50%_0%,black,transparent_55%)]"
        aria-hidden="true"
      />

      <PageHeader />

      <div className="relative mx-auto flex w-full max-w-[1200px] grow flex-col justify-center gap-6 px-6 py-4 sm:px-8">
        <section className="mend-rise text-center">
          <h1 className="font-display text-[2.6rem] leading-[1.04] font-semibold tracking-[-0.025em] text-balance text-foreground sm:text-[3.25rem]">
            {HEADLINE}
          </h1>
          <p className="mx-auto mt-4 max-w-[52ch] text-lg leading-relaxed text-muted-foreground">
            {SUBLINE}
          </p>
          <div className="mt-6 flex flex-col items-center gap-3">
            <InstallCommand />
            <p className="font-mono text-xs text-faint">{TRUST_LINE}</p>
          </div>
        </section>

        <section aria-label="Capabilities" className="mend-rise [animation-delay:0.1s]">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:gap-4">
            {FEATURES.map(({ title, body }, i) => (
              <li
                key={title}
                className="rounded-2xl bg-panel p-5 shadow-[var(--shadow-sm)] transition-[transform,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-[var(--shadow-md)]"
              >
                <p className="font-mono text-xs text-faint">0{i + 1}</p>
                <h2 className="mt-2.5 font-sans text-sm leading-snug font-semibold text-foreground">
                  {title}
                </h2>
                <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="How it works" className="mend-rise [animation-delay:0.2s]">
          <p className="ev-eyebrow">How it works</p>
          <div className="mt-3.5 grid gap-6 border-t border-[var(--sw-soft-rule)] pt-5 lg:grid-cols-3 lg:gap-8">
            {HOW_IT_WORKS.map(({ title, body }) => (
              <div key={title}>
                <h2 className="font-sans text-sm font-semibold text-foreground">{title}</h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

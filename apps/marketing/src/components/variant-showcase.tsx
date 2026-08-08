// VARIANT /5 — /3's grid, but a card opens into a FULL-SCREEN modal: the
// whole story on the left, and a polished rendition of the actual product
// screen on the right. The screens are drawn from apps/web's real pages
// (session · project · review), deliberately more finished than today's
// build — they are the design target the web app works back toward.
// Markup lives here rather than in routes/5.tsx because Tailwind's source
// scanner skips digit-named files.

import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import { Plus, X } from "lucide-react";
import { useState } from "react";

import {
  FEATURES,
  HEADLINE,
  HOW_IT_WORKS,
  InstallCommand,
  PageHeader,
  SUBLINE,
  TRUST_LINE,
} from "#/components/content";
import { DETAILS } from "#/components/details";
import { AppFrame, EXPLAIN, SCREENS } from "#/components/screens";

// ── the page ────────────────────────────────────────────────────────────────

export function MarketingPageShowcase() {
  const [open, setOpen] = useState<number | null>(null);
  const openFeature = open === null ? null : FEATURES[open];
  const openDetail = open === null ? null : DETAILS[open];
  const openScreen = open === null ? null : SCREENS[open];
  const openExplain = open === null ? null : EXPLAIN[open];

  return (
    <MotionConfig reducedMotion="user">
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
                <li key={title} className="min-w-0">
                  <motion.button
                    type="button"
                    layoutId={`sc-card-${i}`}
                    onClick={() => setOpen(i)}
                    aria-haspopup="dialog"
                    aria-expanded={open === i}
                    whileHover={{ y: -4 }}
                    transition={{ layout: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } }}
                    className="group relative flex h-full w-full cursor-pointer flex-col items-start justify-start rounded-2xl bg-panel p-5 text-left shadow-[var(--shadow-sm)] transition-shadow duration-200 hover:shadow-[var(--shadow-md)]"
                  >
                    <Plus
                      className="absolute top-4 right-4 size-3.5 text-faint transition-colors duration-200 group-hover:text-primary"
                      aria-hidden="true"
                    />
                    <p className="font-mono text-xs text-faint">0{i + 1}</p>
                    <h2 className="mt-2.5 font-sans text-sm leading-snug font-semibold text-foreground">
                      {title}
                    </h2>
                    <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
                  </motion.button>
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

        <AnimatePresence>
          {open !== null && openFeature && openDetail && openScreen ? (
            <div
              className="fixed inset-0 z-50 p-3 sm:p-4"
              role="dialog"
              aria-modal="true"
              aria-label={openFeature.title}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(null);
              }}
            >
              <motion.div
                className="absolute inset-0 bg-[color-mix(in_oklab,var(--sw-ink)_24%,transparent)]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.12 } }}
                transition={{ duration: 0.2 }}
                aria-hidden="true"
                onClick={() => setOpen(null)}
              />
              <motion.div
                layoutId={`sc-card-${open}`}
                transition={{ layout: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } }}
                className="relative h-full w-full overflow-hidden rounded-3xl bg-[var(--sw-bg)] shadow-[var(--shadow-overlay)]"
              >
                {/* Content fades fast on close so the reverse morph shrinks an
                    empty panel instead of squishing a whole app screen. */}
                <motion.div
                  className="h-full"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { duration: 0.2, delay: 0.15 } }}
                  exit={{ opacity: 0, transition: { duration: 0.08 } }}
                >
                  <div className="grid h-full lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
                    <div className="flex min-h-0 flex-col overflow-y-auto px-7 py-7 sm:px-9">
                      <p className="font-mono text-xs text-faint">
                        0{open + 1} / 0{FEATURES.length}
                      </p>
                      <h2 className="mt-3 font-display text-2xl font-semibold tracking-[-0.015em] text-foreground">
                        {openFeature.title}
                      </h2>
                      <p className="mt-4 text-[14.5px] leading-relaxed text-foreground/90">
                        {openDetail.detail}
                      </p>
                      <p className="mt-3.5 text-[14.5px] leading-relaxed text-muted-foreground">
                        {openExplain}
                      </p>
                      <div className="mt-auto pt-6">
                        <p className="font-mono text-xs text-faint">esc to close</p>
                      </div>
                    </div>
                    <div className="min-h-0 p-4 pl-0 max-lg:hidden">
                      <AppFrame url={openScreen.url} screen={openScreen.node} />
                    </div>
                  </div>
                </motion.div>
                <button
                  type="button"
                  onClick={() => setOpen(null)}
                  aria-label="Close"
                  autoFocus
                  className="absolute top-4 right-4 z-10 inline-flex size-9 items-center justify-center rounded-lg border border-border bg-panel text-muted-foreground shadow-[var(--shadow-xs)] transition-colors hover:text-foreground"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </motion.div>
            </div>
          ) : null}
        </AnimatePresence>
      </main>
    </MotionConfig>
  );
}

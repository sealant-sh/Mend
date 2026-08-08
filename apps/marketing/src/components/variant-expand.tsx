// VARIANT /3 — visually identical to /, but every capability card opens.
// Click a card and it morphs (framer-motion shared layout) into a centered
// panel: the longer story on the left, a concrete example on the right.
// Markup lives here rather than in routes/3.tsx because Tailwind's source
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

export function MarketingPageExpand() {
  const [open, setOpen] = useState<number | null>(null);
  const openFeature = open === null ? null : FEATURES[open];
  const openDetail = open === null ? null : DETAILS[open];

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
                    layoutId={`f3-card-${i}`}
                    onClick={() => setOpen(i)}
                    aria-haspopup="dialog"
                    aria-expanded={open === i}
                    // The card is the surviving element of the close morph, so
                    // ITS layout transition times the close — keep it fast.
                    // Hover lift lives in whileHover: a CSS transform
                    // transition would lag framer's per-frame layout updates
                    // into slow motion.
                    whileHover={{ y: -4 }}
                    transition={{ layout: { duration: 0.18, ease: [0.22, 1, 0.36, 1] } }}
                    // flex-col: buttons vertically center their content by
                    // default, which pushed short cards' text off the shared
                    // top line the other variants sit on.
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
          {open !== null && openFeature && openDetail ? (
            <div
              className="fixed inset-0 z-50 grid place-items-center p-6"
              role="dialog"
              aria-modal="true"
              aria-label={openFeature.title}
              onClick={() => setOpen(null)}
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
              />
              <motion.div
                layoutId={`f3-card-${open}`}
                onClick={(e) => e.stopPropagation()}
                transition={{ layout: { duration: 0.26, ease: [0.22, 1, 0.36, 1] } }}
                className="relative w-full max-w-[52rem] overflow-hidden rounded-2xl bg-panel p-6 shadow-[var(--shadow-overlay)] sm:p-7"
              >
                {/* The panel morphs; its content only fades. Fading out fast on
                    close means the reverse morph shrinks an empty panel instead
                    of squishing two columns of text into a card. */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { duration: 0.2, delay: 0.12 } }}
                  exit={{ opacity: 0, transition: { duration: 0.08 } }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <p className="font-mono text-xs text-faint">0{open + 1}</p>
                    <button
                      type="button"
                      onClick={() => setOpen(null)}
                      aria-label="Close"
                      autoFocus
                      className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--sw-sunken)] hover:text-foreground"
                    >
                      <X className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="mt-1 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,21rem)] md:gap-8">
                    <div className="min-w-0">
                      <h2 className="font-display text-xl font-semibold tracking-[-0.01em] text-foreground">
                        {openFeature.title}
                      </h2>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        {openFeature.body}
                      </p>
                      <p className="mt-3.5 text-sm leading-relaxed text-foreground/90">
                        {openDetail.detail}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <p className="ev-eyebrow">{openDetail.exampleTitle}</p>
                      <div className="mt-2.5">{openDetail.example}</div>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            </div>
          ) : null}
        </AnimatePresence>
      </main>
    </MotionConfig>
  );
}

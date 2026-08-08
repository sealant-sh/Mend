// VARIANT /4 — the tour: one tab per capability, a big stage below showing
// the active feature's story and exhibit. Auto-advances via the active tab's
// CSS progress line (advance on animationend — no timers, no effects), with a
// pause control. Markup lives here rather than in routes/4.tsx because
// Tailwind's source scanner skips digit-named files.

import { motion, MotionConfig } from "framer-motion";
import {
  FolderGit2,
  Layers,
  MessageSquareText,
  MonitorSmartphone,
  Pause,
  Play,
  Repeat2,
} from "lucide-react";
import { type ComponentType, useState } from "react";

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

type IconType = ComponentType<{ className?: string }>;

// Short tab labels; the stage carries the full titles.
const TABS: ReadonlyArray<{ label: string; icon: IconType }> = [
  { label: "Any TUI", icon: MonitorSmartphone },
  { label: "Harness-agnostic", icon: Repeat2 },
  { label: "Worktrees", icon: FolderGit2 },
  { label: "Review", icon: MessageSquareText },
  { label: "Context packs", icon: Layers },
];

export function MarketingPageTour() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  return (
    <MotionConfig reducedMotion="user">
      <main className="relative flex min-h-dvh flex-col overflow-x-clip bg-[var(--sw-canvas)]">
        <div
          className="mend-dot-grid pointer-events-none absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_at_50%_0%,black,transparent_55%)]"
          aria-hidden="true"
        />

        <PageHeader />

        <div className="relative mx-auto flex w-full max-w-[1200px] grow flex-col justify-center gap-4 px-6 py-2 sm:px-8">
          <section className="mend-rise text-center">
            <h1 className="font-display text-[2.6rem] leading-[1.04] font-semibold tracking-[-0.025em] text-balance text-foreground sm:text-[3.25rem]">
              {HEADLINE}
            </h1>
            <p className="mx-auto mt-3 max-w-[52ch] text-lg leading-relaxed text-muted-foreground">
              {SUBLINE}
            </p>
            <div className="mt-4 flex flex-col items-center gap-3">
              <InstallCommand />
              <p className="font-mono text-xs text-faint">{TRUST_LINE}</p>
            </div>
          </section>

          <section aria-label="Capabilities" className="mend-rise [animation-delay:0.1s]">
            <div className="flex items-center gap-2">
              <div
                className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
                role="tablist"
                aria-label="Capabilities"
              >
                {TABS.map(({ label, icon: Icon }, i) => (
                  <button
                    key={label}
                    type="button"
                    role="tab"
                    aria-selected={active === i}
                    onClick={() => setActive(i)}
                    className={`relative flex min-h-11 cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-xl px-3 font-sans text-[13px] font-medium transition-colors duration-200 ${
                      active === i
                        ? "bg-panel text-foreground shadow-[var(--shadow-sm)]"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {active === i ? (
                      <span
                        className="absolute inset-x-0 top-0 h-0.5 bg-[var(--sw-soft-rule)]"
                        aria-hidden="true"
                      >
                        <span
                          className="mend-tab-progress block h-full bg-primary"
                          style={{ animationPlayState: paused ? "paused" : "running" }}
                          onAnimationEnd={() => setActive((a) => (a + 1) % TABS.length)}
                        />
                      </span>
                    ) : null}
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    {label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setPaused((p) => !p)}
                aria-label={paused ? "Resume the tour" : "Pause the tour"}
                className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-border bg-panel text-muted-foreground shadow-[var(--shadow-xs)] transition-colors duration-200 hover:border-input hover:text-foreground"
              >
                {paused ? (
                  <Play className="size-4" aria-hidden="true" />
                ) : (
                  <Pause className="size-4" aria-hidden="true" />
                )}
              </button>
            </div>

            {/* All five panels stay mounted, stacked in one grid cell, so the
                stage is permanently as tall as its tallest tab — switching
                crossfades without moving anything else on the page. */}
            <div className="relative mt-3 grid overflow-hidden rounded-3xl bg-panel p-5 shadow-[var(--shadow-lg)] sm:px-6">
              {FEATURES.map(({ title }, i) => {
                const d = DETAILS[i];
                return (
                  <motion.div
                    key={title}
                    initial={false}
                    animate={{ opacity: active === i ? 1 : 0, y: active === i ? 0 : 10 }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    aria-hidden={active !== i}
                    className={`grid items-start gap-6 [grid-area:1/1] md:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] md:gap-10 ${
                      active === i ? "" : "pointer-events-none"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-faint">
                        0{i + 1} / 0{TABS.length}
                      </p>
                      <h2 className="mt-2 font-display text-xl font-semibold tracking-[-0.01em] text-foreground sm:text-2xl">
                        {title}
                      </h2>
                      <p className="mt-3 text-sm leading-relaxed text-foreground/90">{d?.detail}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="ev-eyebrow">{d?.exampleTitle}</p>
                      <div className="mt-2.5">{d?.example}</div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </section>

          <section aria-label="How it works" className="mend-rise [animation-delay:0.2s]">
            <p className="ev-eyebrow">How it works</p>
            <div className="mt-3 grid gap-6 border-t border-[var(--sw-soft-rule)] pt-4 lg:grid-cols-3 lg:gap-8">
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
    </MotionConfig>
  );
}

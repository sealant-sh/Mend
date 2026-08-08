// VARIANT /6 — /4's tour, promoted: the hero shrinks to a masthead and the
// stage below the tabs carries what /5's full-screen modal shows — the whole
// story on the left, the polished product screen on the right. Auto-advances
// via the active tab's CSS progress line (advance on animationend — no
// timers, no effects), with a pause control. The page owns exactly one
// viewport: h-dvh on lg, natural flow below it. Markup lives here rather
// than in routes/6.tsx because Tailwind's source scanner skips digit-named
// files.

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
  InstallCommand,
  PageHeader,
  SUBLINE,
  TRUST_LINE,
} from "#/components/content";
import { AppFrame, EXPLAIN, SCREENS } from "#/components/screens";

type IconType = ComponentType<{ className?: string }>;

// Short tab labels; the stage carries the full titles.
const TABS: ReadonlyArray<{ label: string; icon: IconType }> = [
  { label: "Any TUI", icon: MonitorSmartphone },
  { label: "Harness-agnostic", icon: Repeat2 },
  { label: "Worktrees", icon: FolderGit2 },
  { label: "Review", icon: MessageSquareText },
  { label: "Context packs", icon: Layers },
];

export function MarketingPageFocus() {
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

        <div className="relative mx-auto flex w-full max-w-[1200px] grow flex-col justify-center gap-3 px-6 py-2 sm:px-8">
          {/* The masthead — the hero, shifted up to a single tight block. */}
          <section className="mend-rise shrink-0 text-center">
            <h1 className="font-display text-3xl leading-[1.06] font-semibold tracking-[-0.025em] text-balance text-foreground sm:text-4xl">
              {HEADLINE}
            </h1>
            <div className="mt-2.5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
              <p className="text-[15px] leading-relaxed text-balance text-muted-foreground">
                {SUBLINE}
              </p>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
              <InstallCommand />
              <p className="font-mono text-xs text-faint">{TRUST_LINE}</p>
            </div>
          </section>

          <section aria-label="Capabilities" className="mend-rise [animation-delay:0.1s]">
            <div className="flex shrink-0 items-center gap-2">
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

            {/* The stage: /5's modal interior, permanently open. All five
                panels stay mounted in one grid cell — no layout shift. */}
            {/* Capped, not full-bleed: tall enough for the screen to read as
                real, short enough that the page still breathes. */}
            {/* Sized by subtraction: the viewport minus everything above it
                (header + hero + tabs ≈ 22.5rem), so the stage takes all the
                real leftover and the small remainder centers the column. */}
            <div className="relative mt-3 grid h-[clamp(26rem,calc(100dvh-22.5rem),36rem)] overflow-hidden rounded-3xl bg-[var(--sw-bg)] shadow-[var(--shadow-lg)]">
              {FEATURES.map(({ title, body }, i) => {
                const screen = SCREENS[i];
                return (
                  <motion.div
                    key={title}
                    initial={false}
                    animate={{ opacity: active === i ? 1 : 0, y: active === i ? 0 : 10 }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    aria-hidden={active !== i}
                    className={`grid h-full min-h-0 [grid-area:1/1] lg:grid-cols-[minmax(0,23rem)_minmax(0,1fr)] ${
                      active === i ? "" : "pointer-events-none"
                    }`}
                  >
                    {/* The short claim leads; the product story follows. The
                        deeper technical paragraph lives on /5, where the
                        full-screen modal has room for it. */}
                    <div className="flex min-h-0 flex-col justify-center overflow-hidden px-7 py-5 sm:px-8">
                      <p className="font-mono text-xs text-faint">
                        0{i + 1} / 0{FEATURES.length}
                      </p>
                      <h2 className="mt-2.5 font-display text-2xl leading-snug font-semibold tracking-[-0.015em] text-foreground">
                        {title}
                      </h2>
                      <p className="mt-3.5 text-[14.5px] leading-relaxed text-foreground/90">
                        {body}
                      </p>
                      <p className="mt-3 text-[14.5px] leading-relaxed text-muted-foreground">
                        {EXPLAIN[i]}
                      </p>
                    </div>
                    {screen ? (
                      <div className="min-h-0 p-4 pl-0 max-lg:hidden">
                        <AppFrame url={screen.url} screen={screen.node} />
                      </div>
                    ) : null}
                  </motion.div>
                );
              })}
            </div>
          </section>
        </div>
      </main>
    </MotionConfig>
  );
}

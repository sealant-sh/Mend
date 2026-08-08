// THE PAGE — one screen, no pitch: a tight masthead (claim + install line),
// a tab per capability, and a stage that carries the whole story — copy on
// the left, a polished product screen on the right. The tour auto-advances
// via the active tab's CSS progress line (advance on animationend — no
// timers, no effects), with a pause control; clicking a tab jumps. The
// stage's corner expands the active capability into a full-screen read:
// deeper copy, the same screen larger, and the mobile app beside it.

import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import {
  ChevronDown,
  FolderGit2,
  Layers,
  // Maximize2, — expand disabled for now
  MessageSquareText,
  MonitorSmartphone,
  Pause,
  Play,
  Repeat2,
  X,
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
import { EXPANDED_LAYOUTS } from "#/components/expanded";
import { AppFrame, EXPLAIN, SCREENS } from "#/components/screens";

type IconType = ComponentType<{ className?: string }>;

// Short tab labels; the stage carries the full titles.
const TABS: ReadonlyArray<{ label: string; icon: IconType }> = [
  { label: "Any TUI", icon: MonitorSmartphone },
  { label: "Worktrees", icon: FolderGit2 },
  { label: "Review", icon: MessageSquareText },
  { label: "Context packs", icon: Layers },
  { label: "Harness-agnostic", icon: Repeat2 },
];

// Display order over the content arrays (FEATURES/EXPLAIN/SCREENS keep their
// original indexes).
const ORDER = [0, 2, 3, 4, 1] as const;

export function MarketingPage() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [openMobile, setOpenMobile] = useState(0);
  const feature = FEATURES[active];

  return (
    <MotionConfig reducedMotion="user">
      <main className="relative flex min-h-dvh flex-col overflow-x-clip bg-[var(--sw-canvas)]">
        <div
          className="mend-dot-grid pointer-events-none absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_at_50%_0%,black,transparent_55%)]"
          aria-hidden="true"
        />

        <PageHeader />

        <div className="relative mx-auto flex w-full max-w-[1200px] grow flex-col justify-center gap-4 px-5 py-6 sm:px-8 lg:gap-3 lg:py-2">
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
            <div className="flex shrink-0 items-center gap-2 max-lg:hidden">
              <div
                className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1 lg:grid lg:grid-cols-5 lg:overflow-visible lg:pb-0"
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
                    className={`relative flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-xl px-3.5 font-sans text-[13px] font-medium whitespace-nowrap transition-colors duration-200 lg:px-3 ${
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
                          // The dwell pauses while reading the expanded view.
                          style={{
                            animationPlayState: paused || expanded ? "paused" : "running",
                          }}
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

            {/* The stage. All five panels stay mounted in one grid cell — no
                layout shift. Sized by subtraction: the viewport minus
                everything above it (header + hero + tabs ≈ 22.5rem). */}
            <motion.div
              layoutId="tour-stage"
              transition={{ layout: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } }}
              className="relative mt-3 grid overflow-hidden rounded-3xl lg:h-[clamp(26rem,calc(100dvh-22.5rem),36rem)] bg-[var(--sw-bg)] shadow-[var(--shadow-lg)] max-lg:hidden"
            >
              {ORDER.map((orig, i) => {
                const item = FEATURES[orig];
                const title = item?.title ?? "";
                const body = item?.body;
                const s = SCREENS[orig];
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
                        deeper mechanism copy lives in the expanded view. */}
                    <div className="flex min-h-0 flex-col justify-start overflow-hidden px-6 pt-7 pb-6 [overflow-wrap:anywhere] sm:px-8 lg:pt-9 lg:pb-5">
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
                        {EXPLAIN[orig]}
                      </p>
                    </div>
                    {s ? (
                      <div className="min-h-0 p-4 pl-0 max-lg:hidden">
                        <AppFrame url={s.url} screen={s.node} />
                      </div>
                    ) : null}
                  </motion.div>
                );
              })}
              {/* expand disabled for this deploy — revisit
              <button
                type="button"
                onClick={() => setExpanded(true)}
                aria-label="Expand this capability"
                className="absolute top-2.5 right-2.5 z-10 inline-flex size-9 cursor-pointer items-center justify-center rounded-lg border border-border bg-panel text-muted-foreground shadow-[var(--shadow-xs)] transition-colors duration-200 hover:border-input hover:text-foreground max-lg:hidden"
              >
                <Maximize2 className="size-4" aria-hidden="true" />
              </button>
              */}
            </motion.div>

            {/* Mobile: the tour doesn't fit a phone — the five capabilities
                stack as an accordion instead. */}
            <div className="overflow-hidden rounded-2xl bg-[var(--sw-bg)] shadow-[var(--shadow-sm)] lg:hidden">
              {ORDER.map((orig, i) => {
                const entry = FEATURES[orig];
                const tab = TABS[i];
                if (!entry || !tab) return null;
                const Icon = tab.icon;
                const open = openMobile === i;
                return (
                  <div
                    key={entry.title}
                    className={i === 0 ? "" : "border-t border-[var(--sw-faint-rule)]"}
                  >
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setOpenMobile(open ? -1 : i)}
                      className="flex w-full cursor-pointer items-center gap-3 px-5 py-4 text-left"
                    >
                      <Icon
                        className={`size-4 shrink-0 ${open ? "text-primary" : "text-muted-foreground"}`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 font-sans text-[15px] font-semibold text-foreground">
                        {entry.title}
                      </span>
                      <ChevronDown
                        className={`size-4 shrink-0 text-faint transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                        aria-hidden="true"
                      />
                    </button>
                    {open ? (
                      <div className="mend-appear px-5 pb-5 [overflow-wrap:anywhere]">
                        <p className="text-[14px] leading-relaxed text-foreground/90">
                          {entry.body}
                        </p>
                        <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
                          {EXPLAIN[orig]}
                        </p>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* The expanded read: the stage, promoted to the whole viewport —
            deeper copy on the left, the screen larger, the mobile app beside
            it. Same shared-layout morph discipline as ever: content fades
            fast on close so an empty panel shrinks back. */}
        <AnimatePresence>
          {expanded && feature ? (
            <div
              className="fixed inset-0 z-50 p-3 sm:p-4"
              role="dialog"
              aria-modal="true"
              aria-label={feature.title}
              onKeyDown={(e) => {
                if (e.key === "Escape") setExpanded(false);
              }}
            >
              <motion.div
                className="absolute inset-0 bg-[color-mix(in_oklab,var(--sw-ink)_24%,transparent)]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.12 } }}
                transition={{ duration: 0.2 }}
                aria-hidden="true"
                onClick={() => setExpanded(false)}
              />
              <motion.div
                layoutId="tour-stage"
                transition={{ layout: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } }}
                className="relative h-full w-full overflow-hidden rounded-3xl bg-[var(--sw-bg)] shadow-[var(--shadow-overlay)]"
              >
                {/* Five bespoke compositions — see EXPANDED_LAYOUTS. The
                    shell only fades them; each layout owns its canvas. */}
                <motion.div
                  className="h-full max-lg:overflow-y-auto"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { duration: 0.2, delay: 0.14 } }}
                  exit={{ opacity: 0, transition: { duration: 0.08 } }}
                >
                  {EXPANDED_LAYOUTS[active]}
                </motion.div>
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
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

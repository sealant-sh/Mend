// THE HERO — repo-header energy: the name, three factual sentences, the
// exhibit. The harness word in `mend claude` cycles because the claim is
// harness-agnostic; the rest of the line stays the same on purpose.

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { GitHubLogo } from "#/components/github";
import { MendMark } from "#/components/logo";
import { PrimaryCTA, REPO_URL, riseChild, riseParent, SecondaryCTA } from "#/components/primitives";

// One terminal line: prompt lines in ink, output muted, stage directions faint.
type LineTone = "cmd" | "out" | "live" | "note" | "blank";

const LINES: ReadonlyArray<readonly [LineTone, string]> = [
  ["cmd", "pwd"],
  ["out", "/home/dev/code/billing-service"],
  ["blank", ""],
  ["cmd", "mend codex"],
  ["out", "new project — adopting into the store, provisioning a worktree"],
  ["live", "session 01J8QK4M · recording"],
  ["blank", ""],
  ["out", "  [ Codex runs here, unchanged ]"],
];

function HeroTerminal() {
  return (
    <div className="overflow-x-auto rounded-2xl border border-rule bg-[var(--sw-sunken)] px-5 py-5 font-mono text-[0.78rem] leading-[1.85] shadow-[var(--shadow-lg)]">
      <pre>
        <code>
          {LINES.map(([tone, text], i) => (
            <span key={i} className="block whitespace-pre">
              {tone === "blank" ? (
                <span> </span>
              ) : tone === "cmd" ? (
                <>
                  <span className="text-faint select-none">$ </span>
                  <span className="text-ink-2">{text}</span>
                </>
              ) : tone === "live" ? (
                <>
                  <span className="text-muted-foreground">
                    {text.slice(0, text.length - "recording".length)}
                  </span>
                  <span className="text-success">recording</span>
                </>
              ) : tone === "note" ? (
                <span className="text-faint">{text}</span>
              ) : (
                <span className="text-muted-foreground">{text}</span>
              )}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

const HARNESSES = ["claude", "codex", "pi"];
const LONGEST_HARNESS = HARNESSES.reduce((a, b) => (b.length > a.length ? b : a));

function CyclingHarness() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setIndex((i) => (i + 1) % HARNESSES.length), 2600);
    return () => window.clearInterval(id);
  }, []);
  const word = HARNESSES[index] ?? LONGEST_HARNESS;
  return (
    <span className="inline-grid overflow-hidden text-left align-bottom">
      <span className="invisible [grid-area:1/1]" aria-hidden="true">
        {LONGEST_HARNESS}
      </span>
      <AnimatePresence initial={false}>
        <motion.span
          key={word}
          className="text-primary [grid-area:1/1]"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          {word}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

// Reduced motion is handled by the page-level MotionConfig — see Reveal.
export function Hero() {
  const parent = { variants: riseParent, initial: "hidden" as const, animate: "show" as const };
  const child = { variants: riseChild };

  return (
    <section className="relative overflow-hidden bg-[var(--sw-canvas)]">
      <div
        className="mend-dot-grid pointer-events-none absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_at_20%_0%,black,transparent_65%)]"
        aria-hidden="true"
      />
      <div className="relative mx-auto w-full max-w-[1200px] px-6 py-16 sm:px-8 lg:py-24">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,27rem)_1fr] lg:gap-14">
          <motion.div className="min-w-0" {...parent}>
            <motion.div {...child} className="flex items-center gap-3.5">
              <MendMark className="size-11 sm:size-14" aria-hidden="true" />
              <h1 className="font-display text-5xl leading-none font-semibold tracking-[-0.03em] text-foreground sm:text-6xl lg:text-[4.2rem]">
                Mend
              </h1>
            </motion.div>
            <motion.p
              {...child}
              className="mt-8 max-w-[46ch] text-lg leading-relaxed text-muted-foreground"
            >
              One harness-agnostic repo and context store, reachable from any of your devices — your
              phone included. First-class review for everything your agents write, on your own
              infra.
            </motion.p>
            <motion.p {...child} className="mt-4 text-lg leading-relaxed text-muted-foreground">
              <code className="font-mono text-[0.92em] text-foreground">
                mend <CyclingHarness />
              </code>{" "}
              — and everything else stays the same.
            </motion.p>
            <motion.div {...child} className="mt-8 flex flex-wrap items-center gap-3">
              <PrimaryCTA href={REPO_URL}>
                <GitHubLogo className="size-4" />
                GitHub
              </PrimaryCTA>
              <SecondaryCTA href="#how" external={false}>
                How it works
              </SecondaryCTA>
            </motion.div>
            <motion.p {...child} className="mt-6 font-mono text-xs text-faint">
              Open source · Self-hosted · In development
            </motion.p>
          </motion.div>

          <motion.div
            className="min-w-0"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
          >
            <p className="mb-3 font-mono text-xs text-faint">
              <span className="text-ink-2">$ codex → $ mend codex</span> · the same agent
            </p>
            <HeroTerminal />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

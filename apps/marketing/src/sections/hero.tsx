// THE HERO — one concrete claim with the tool name cycling, one sentence of
// consequence, the terminal showing the command.

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { GitHubLogo } from "#/components/github";
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

const HARNESSES = ["Claude Code", "Codex CLI", "OpenCode"];
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
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -14 }}
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
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,30rem)_1fr] lg:gap-14">
          <motion.div className="min-w-0" {...parent}>
            <motion.h1
              {...child}
              className="font-display text-[2.5rem] leading-[1.12] font-semibold tracking-[-0.03em] text-foreground sm:text-5xl lg:text-[3.1rem]"
            >
              Run <CyclingHarness /> remotely from your local machine.
            </motion.h1>
            <motion.p
              {...child}
              className="mt-6 max-w-[46ch] text-lg leading-relaxed text-muted-foreground"
            >
              The session runs on a server you own and stays reachable from every device you have,
              phone included.
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
              Open source · Self-hosted
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

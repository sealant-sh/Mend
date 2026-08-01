// THE HERO — one plain claim: the session lives on the Mend host, not the
// terminal that opened it. The exhibit is the moment itself: start the agent,
// detach, come back from a different machine.

import { motion } from "framer-motion";

import { GitHubLogo } from "#/components/github";
import { PrimaryCTA, REPO_URL, riseChild, riseParent, SecondaryCTA } from "#/components/primitives";

// One terminal line: prompt lines in ink, output muted, stage directions faint.
type LineTone = "cmd" | "out" | "live" | "note" | "blank";

const LINES: ReadonlyArray<readonly [LineTone, string]> = [
  ["cmd", "mend adopt https://github.com/acme/billing-service"],
  ["out", "adopted · ~/.mend/store/billing-service/repo.git · main"],
  ["blank", ""],
  ["cmd", "mend claude"],
  ["live", "session 01J8QK4M · worktree mend/session/01J8QK4M · recording"],
  ["out", "  [ Claude Code runs here, unchanged ]"],
  ["blank", ""],
  ["note", "^] detached — the session keeps running"],
  ["blank", ""],
  ["note", "# later, on a different machine"],
  ["cmd", "mend attach 01J8"],
  ["out", "session 01J8QK4M · attached · 212 events recorded"],
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
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,29rem)_1fr] lg:gap-14">
          <motion.div className="min-w-0" {...parent}>
            <motion.div {...child}>
              <span className="ev-eyebrow">Open-source agent workbench · self-hosted</span>
            </motion.div>
            <motion.h1
              {...child}
              className="mt-6 font-display text-[2.6rem] leading-[1.08] font-semibold tracking-[-0.03em] text-foreground sm:text-5xl lg:text-[3.3rem]"
            >
              Runs your TUIs in your cloud.
            </motion.h1>
            <motion.p
              {...child}
              className="mt-6 max-w-[46ch] text-lg leading-relaxed text-muted-foreground"
            >
              Mend runs Claude Code, Codex, or any command you give it in a recorded git worktree on
              a machine you control.{" "}
              <span className="text-foreground">
                The session — worktree, conversation, record — lives there, not on whichever client
                opened it.
              </span>
            </motion.p>
            <motion.p
              {...child}
              className="mt-4 max-w-[46ch] text-[0.95rem] leading-relaxed text-muted-foreground"
            >
              Detach and the agent keeps going. Attach again from another computer or your phone.
              When the work settles, review the accumulated change with the session record beside
              it.
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
              <span className="text-ink-2">$ claude → $ mend claude</span> · the same agent
            </p>
            <HeroTerminal />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// THE HERO — the product's ownership thesis: the session belongs to the
// developer, not the laptop or harness that happened to start it. The record
// beside it is the proof that this is one durable piece of work.

import { motion } from "framer-motion";

import { GitHubLogo } from "#/components/github";
import { PrimaryCTA, REPO_URL, riseChild, riseParent, SecondaryCTA } from "#/components/primitives";
import { RunRecord } from "#/components/run-record";

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
              <span className="ev-eyebrow inline-flex items-center gap-2 text-primary">
                <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
                your agent · your session · any device
              </span>
            </motion.div>
            <motion.h1
              {...child}
              className="mt-6 font-display text-[2.6rem] leading-[1.08] font-semibold tracking-[-0.03em] text-foreground sm:text-5xl lg:text-[3.3rem]"
            >
              Your coding sessions should belong to you.
            </motion.h1>
            <motion.p
              {...child}
              className="mt-6 max-w-[46ch] text-lg leading-relaxed text-muted-foreground"
            >
              Put <code className="font-mono text-[0.85em] text-foreground">mend</code> in front of
              Claude Code or Codex.{" "}
              <span className="text-foreground">
                The worktree, conversation, and record live on your Mend host — not the client or
                harness you happen to be using.
              </span>
            </motion.p>
            <motion.p
              {...child}
              className="mt-4 max-w-[46ch] text-[0.95rem] leading-relaxed text-muted-foreground"
            >
              Keep the CLI you already like. Pick the work up from another computer or your phone,
              resume it with the same agent, or switch between Claude Code and Codex in beta. Review
              the local change with its recorded session one click away.
            </motion.p>
            <motion.div {...child} className="mt-8 flex flex-wrap items-center gap-3">
              <PrimaryCTA href={REPO_URL}>
                <GitHubLogo className="size-4" />
                GitHub
              </PrimaryCTA>
              <SecondaryCTA href="#sessions" external={false}>
                See how sessions work
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
              <span className="text-ink-2">$ claude → $ mend claude</span> · one extra word, the
              same agent
            </p>
            <RunRecord
              runId="session 01J8QK4M"
              capture="00:33.415"
              status={{ word: "Running · recorded", tone: "observed" }}
              lift
              events={[
                {
                  seq: 12,
                  offset: "00:02.114",
                  name: "process.started",
                  detail: "claude · pty attached",
                  provenance: "observed",
                },
                {
                  seq: 41,
                  offset: "00:19.310",
                  name: "process.exited",
                  detail: "pnpm test · exit 1 · reproduced",
                  provenance: "observed",
                },
                {
                  seq: 87,
                  offset: "00:26.882",
                  name: "file.modified",
                  detail: "src/invoice.ts",
                  provenance: "observed",
                },
                {
                  seq: 198,
                  offset: "00:33.415",
                  name: "process.exited",
                  detail: "pnpm test · exit 0 · 14 passed",
                  provenance: "observed",
                },
              ]}
              diff={{
                file: "src/invoice.ts",
                lines: [
                  { sign: " ", text: "const discounted = subtotal - discount(subtotal);" },
                  { sign: "-", text: "return round(subtotal) - discount(subtotal);" },
                  { sign: "+", text: "return round(discounted);" },
                ],
              }}
              footnote="worktree mend/session/01J8QK4M · change ready to review"
              illustrative
            />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

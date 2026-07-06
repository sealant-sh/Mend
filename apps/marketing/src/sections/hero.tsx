// THE HERO — the problem in the title, the answer and the differentiator in
// the subtitle, and the product beside it: the brief, already compiled.
// Left-aligned two-column layout — deliberately not the platform site's
// centered hero.

import { motion, useReducedMotion } from "framer-motion";

import { Brief } from "#/components/brief";
import { GitHubLogo } from "#/components/github";
import { PrimaryCTA, REPO_URL, riseChild, riseParent, SecondaryCTA } from "#/components/primitives";

export function Hero() {
  const reduce = useReducedMotion();
  const parent = reduce
    ? {}
    : { variants: riseParent, initial: "hidden" as const, animate: "show" as const };
  const child = reduce ? {} : { variants: riseChild };

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
                issue → mended → merged
              </span>
            </motion.div>
            <motion.h1
              {...child}
              className="mt-6 font-display text-[2.6rem] leading-[1.08] font-semibold tracking-[-0.03em] text-foreground sm:text-5xl lg:text-[3.3rem]"
            >
              <span className="block">Code is now cheap.</span>
              <span className="block">Trust is not.</span>
            </motion.h1>
            <motion.p
              {...child}
              className="mt-6 max-w-[46ch] text-lg leading-relaxed text-muted-foreground"
            >
              Mend reviews every change against a full recording of how it was made.{" "}
              <span className="text-foreground">Everything else reads the diff and guesses.</span>
            </motion.p>
            <motion.p
              {...child}
              className="mt-4 max-w-[46ch] text-[0.95rem] leading-relaxed text-muted-foreground"
            >
              A coding agent fixes the issue from your tracker — GitHub, Linear, or Jira — in a
              recorded workspace. The pull request arrives with the review done.
            </motion.p>
            <motion.div {...child} className="mt-8 flex flex-wrap items-center gap-3">
              <PrimaryCTA href={REPO_URL}>
                <GitHubLogo className="size-4" />
                GitHub
              </PrimaryCTA>
              <SecondaryCTA href="#review" external={false}>
                Read the brief
              </SecondaryCTA>
            </motion.div>
            <motion.p {...child} className="mt-6 font-mono text-xs text-faint">
              Open source · Self-hosted · In development
            </motion.p>
          </motion.div>

          <motion.div
            className="min-w-0"
            {...(reduce
              ? {}
              : {
                  initial: { opacity: 0, y: 24 },
                  animate: { opacity: 1, y: 0 },
                  transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.15 },
                })}
          >
            <Brief variant="compact" lift illustrative />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

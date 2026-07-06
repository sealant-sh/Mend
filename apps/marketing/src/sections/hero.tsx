// THE HERO — the artifact, not the promise. A centered claim, then the Mend
// Exhibit as the hero screenshot: an issue in, the mending run, and the
// reviewed pull request out with its evidence attached. Static-legible; the
// page opens on a change that is ready to review.

import { motion, useReducedMotion } from "framer-motion";

import { GitHubLogo } from "#/components/github";
import { MendExhibit } from "#/components/mend-exhibit";
import {
  PLATFORM_SITE_URL,
  PrimaryCTA,
  REPO_URL,
  riseChild,
  riseParent,
  SecondaryCTA,
} from "#/components/primitives";

export function Hero() {
  const reduce = useReducedMotion();
  const parent = reduce
    ? {}
    : { variants: riseParent, initial: "hidden" as const, animate: "show" as const };
  const child = reduce ? {} : { variants: riseChild };

  return (
    <section className="relative overflow-hidden bg-[var(--sw-canvas)]">
      <div
        className="mend-dot-grid pointer-events-none absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_at_50%_0%,black,transparent_70%)]"
        aria-hidden="true"
      />
      <div className="relative mx-auto w-full max-w-[1200px] px-6 py-20 sm:px-8 lg:py-28">
        <motion.div className="mx-auto max-w-[58ch] text-center" {...parent}>
          <motion.div {...child}>
            <span className="ev-eyebrow inline-flex items-center gap-2 text-primary">
              <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
              Issue → reviewed change → PR · by Sealant
            </span>
          </motion.div>
          <motion.h1
            {...child}
            className="mt-6 font-display text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.03em] text-foreground text-balance sm:text-5xl lg:text-[3.4rem]"
          >
            File the issue. Review the pull request.
          </motion.h1>
          <motion.p
            {...child}
            className="mx-auto mt-6 max-w-[58ch] text-lg leading-relaxed text-muted-foreground"
          >
            Mend hands your GitHub issue to a coding harness in a self-hosted Sealant sandbox and
            hands back a pull request with the whole run attached: the diff, the commands, the
            checks, the artifacts, and a record you can replay.
          </motion.p>
          <motion.div {...child} className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <PrimaryCTA href={REPO_URL}>
              <GitHubLogo className="size-4" />
              GitHub
            </PrimaryCTA>
            <SecondaryCTA href={PLATFORM_SITE_URL}>Built on Sealant</SecondaryCTA>
          </motion.div>
          <motion.p {...child} className="mt-6 font-mono text-xs text-faint">
            Open source · Self-hosted · Building now · Powered by @sealant/sdk
          </motion.p>
        </motion.div>

        <motion.div
          className="mx-auto mt-14 max-w-3xl lg:mt-16"
          {...(reduce
            ? {}
            : {
                initial: { opacity: 0, y: 24 },
                animate: { opacity: 1, y: 0 },
                transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.2 },
              })}
        >
          <MendExhibit lift illustrative />
        </motion.div>
      </div>
    </section>
  );
}

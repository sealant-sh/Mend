import { createFileRoute } from "@tanstack/react-router";
import { MotionConfig } from "framer-motion";

import { Evidence } from "#/sections/evidence";
import { FinalCta } from "#/sections/final-cta";
import { Hero } from "#/sections/hero";
import { Mobile } from "#/sections/mobile";
import { WhatsNext } from "#/sections/next";
import { Review } from "#/sections/review";
import { Servers } from "#/sections/servers";
import { Sessions } from "#/sections/sessions";
import { Why } from "#/sections/why";

export const Route = createFileRoute("/")({
  component: MarketingPage,
});

// Problem-led: the hero states the claim, the five problems follow, and each
// answer section lands in the same order — store/harness → phone → dev
// servers → review — then where the record comes from, what's planned, and
// the ask.
function MarketingPage() {
  return (
    <MotionConfig reducedMotion="user">
      <main className="overflow-x-clip">
        <Hero />
        <Why />
        <Sessions />
        <Mobile />
        <Servers />
        <Review />
        <Evidence />
        <WhatsNext />
        <FinalCta />
      </main>
    </MotionConfig>
  );
}

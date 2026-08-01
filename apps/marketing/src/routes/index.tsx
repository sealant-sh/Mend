import { createFileRoute } from "@tanstack/react-router";
import { MotionConfig } from "framer-motion";

import { Evidence } from "#/sections/evidence";
import { FinalCta } from "#/sections/final-cta";
import { Hero } from "#/sections/hero";
import { Mobile } from "#/sections/mobile";
import { WhatsNext } from "#/sections/next";
import { Review } from "#/sections/review";
import { Sessions } from "#/sections/sessions";
import { Why } from "#/sections/why";

export const Route = createFileRoute("/")({
  component: MarketingPage,
});

// One causal story: the claim (the session lives on your host) → the trap it
// replaces → the mechanics → the review → the phone → where the record comes
// from → what's planned → the ask. Everything before "What's next" runs today.
function MarketingPage() {
  return (
    <MotionConfig reducedMotion="user">
      <main className="overflow-x-clip">
        <Hero />
        <Why />
        <Sessions />
        <Review />
        <Mobile />
        <Evidence />
        <WhatsNext />
        <FinalCta />
      </main>
    </MotionConfig>
  );
}

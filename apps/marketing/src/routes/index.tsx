import { createFileRoute } from "@tanstack/react-router";
import { MotionConfig } from "framer-motion";

import { BrowserSection } from "#/sections/browser";
import { ContextSection } from "#/sections/context";
import { Evidence } from "#/sections/evidence";
import { FinalCta } from "#/sections/final-cta";
import { Hero } from "#/sections/hero";
import { Mobile } from "#/sections/mobile";
import { OpenSource } from "#/sections/opensource";
import { Review } from "#/sections/review";
import { Sessions } from "#/sections/sessions";
import { Why } from "#/sections/why";

export const Route = createFileRoute("/")({
  component: MarketingPage,
});

// One causal story, not a feature bag: the ownership thesis → what traps work
// today → add one word to the agent CLI → the whole session (including its
// planned dev server) becomes reachable → review the local change → prove it
// on a phone → explain the record → planned context → trust posture → the ask.
function MarketingPage() {
  return (
    <MotionConfig reducedMotion="user">
      <main className="overflow-x-clip">
        <Hero />
        <Why />
        <Sessions />
        <BrowserSection />
        <Review />
        <Mobile />
        <Evidence />
        <ContextSection />
        <OpenSource />
        <FinalCta />
      </main>
    </MotionConfig>
  );
}

import { createFileRoute } from "@tanstack/react-router";

import { Evidence } from "#/sections/evidence";
import { FinalCta } from "#/sections/final-cta";
import { Hero } from "#/sections/hero";
import { LoopStrip } from "#/sections/loop-strip";
import { Mobile } from "#/sections/mobile";
import { OpenSource } from "#/sections/opensource";
import { HowItWorks } from "#/sections/queue";
import { Why } from "#/sections/why";

export const Route = createFileRoute("/")({
  component: MarketingPage,
});

// Ordered for a developer meeting Mend before Sealant: the artifact (hero) →
// the loop in one line → why the current workflow fails → the evidence and
// the runtime underneath it → how the product works → the mobile app → open
// source → the ask.
function MarketingPage() {
  return (
    <main className="overflow-x-clip">
      <Hero />
      <LoopStrip />
      <Why />
      <Evidence />
      <Mobile />
      <HowItWorks />
      <OpenSource />
      <FinalCta />
    </main>
  );
}

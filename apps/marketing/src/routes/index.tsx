import { createFileRoute } from "@tanstack/react-router";

import { BriefSection } from "#/sections/brief-section";
import { Evidence } from "#/sections/evidence";
import { FinalCta } from "#/sections/final-cta";
import { Hero } from "#/sections/hero";
import { Mobile } from "#/sections/mobile";
import { OpenSource } from "#/sections/opensource";
import { HowItWorks } from "#/sections/queue";
import { Sources } from "#/sections/sources";
import { Why } from "#/sections/why";

export const Route = createFileRoute("/")({
  component: MarketingPage,
});

// Ordered per MEND-PLAN §11: the problem and the product (hero) → why this
// exists → the brief, walked → the source trail → mobile → where the
// recording comes from (Sealant) → the loop → open source → the ask.
function MarketingPage() {
  return (
    <main className="overflow-x-clip">
      <Hero />
      <Why />
      <BriefSection />
      <Sources />
      <Mobile />
      <Evidence />
      <HowItWorks />
      <OpenSource />
      <FinalCta />
    </main>
  );
}

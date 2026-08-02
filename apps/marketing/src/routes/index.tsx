import { createFileRoute } from "@tanstack/react-router";
import { MotionConfig } from "framer-motion";

import { Evidence } from "#/sections/evidence";
import { Hero } from "#/sections/hero";
import { Mobile } from "#/sections/mobile";
import { Review } from "#/sections/review";
import { Sessions } from "#/sections/sessions";

export const Route = createFileRoute("/")({
  component: MarketingPage,
});

// Feature-led: the hero makes one concrete claim, then each section shows a
// capability — sessions on your server, the phone app, the review, and the
// runtime underneath.
function MarketingPage() {
  return (
    <MotionConfig reducedMotion="user">
      <main className="overflow-x-clip">
        <Hero />
        <Sessions />
        <Mobile />
        <Review />
        <Evidence />
      </main>
    </MotionConfig>
  );
}

import { createFileRoute } from "@tanstack/react-router";

import { FinalCta } from "#/sections/final-cta";
import { Hero } from "#/sections/hero";
import { LoopStrip } from "#/sections/loop-strip";
import { OpenSource } from "#/sections/opensource";
import { Queue } from "#/sections/queue";
import { Review } from "#/sections/review";
import { BuiltOnSdk } from "#/sections/sdk";

export const Route = createFileRoute("/")({
  component: MarketingPage,
});

// Ordered by value: the reviewed change (hero) → the loop → the review surface
// (evidence) → the queue (product surface) → built on the public SDK → open
// source → adopt.
function MarketingPage() {
  return (
    <main className="overflow-x-clip">
      <Hero />
      <LoopStrip />
      <Review />
      <Queue />
      <BuiltOnSdk />
      <OpenSource />
      <FinalCta />
    </main>
  );
}

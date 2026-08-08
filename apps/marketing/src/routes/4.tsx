// Route shim only — the page lives in components/variant-tour.tsx, because
// Tailwind's source scanner skips this digit-named file and would drop any
// class that appears only here.

import { createFileRoute } from "@tanstack/react-router";

import { MarketingPageTour } from "#/components/variant-tour";

export const Route = createFileRoute("/4")({
  component: MarketingPageTour,
});

// Route shim only — the page lives in components/variant-showcase.tsx,
// because Tailwind's source scanner skips this digit-named file and would
// drop any class that appears only here.

import { createFileRoute } from "@tanstack/react-router";

import { MarketingPageShowcase } from "#/components/variant-showcase";

export const Route = createFileRoute("/5")({
  component: MarketingPageShowcase,
});

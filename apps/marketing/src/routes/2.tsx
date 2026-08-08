// Route shim only — the page lives in components/variant-dense.tsx, because
// Tailwind's source scanner skips this digit-named file and would drop any
// class that appears only here.

import { createFileRoute } from "@tanstack/react-router";

import { MarketingPageDense } from "#/components/variant-dense";

export const Route = createFileRoute("/2")({
  component: MarketingPageDense,
});

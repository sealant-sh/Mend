// Route shim only — the page lives in components/variant-expand.tsx, because
// Tailwind's source scanner skips this digit-named file and would drop any
// class that appears only here.

import { createFileRoute } from "@tanstack/react-router";

import { MarketingPageExpand } from "#/components/variant-expand";

export const Route = createFileRoute("/3")({
  component: MarketingPageExpand,
});

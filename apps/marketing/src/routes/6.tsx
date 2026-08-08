// Route shim only — the page lives in components/variant-focus.tsx, because
// Tailwind's source scanner skips this digit-named file and would drop any
// class that appears only here.

import { createFileRoute } from "@tanstack/react-router";

import { MarketingPageFocus } from "#/components/variant-focus";

export const Route = createFileRoute("/6")({
  component: MarketingPageFocus,
});

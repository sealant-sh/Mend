import { createFileRoute } from "@tanstack/react-router";

import { MarketingPage } from "#/components/page";

export const Route = createFileRoute("/")({
  component: MarketingPage,
});

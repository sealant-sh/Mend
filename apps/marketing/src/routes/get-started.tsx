import { createFileRoute } from "@tanstack/react-router";

import { GetStartedPage } from "#/components/get-started";

const TITLE = "Get started with Mend — install, connect, review";
const DESCRIPTION =
  "Install Mend on your own machine in one line, sign the CLI in, connect your agent accounts, adopt a repository, start a session, review the change, and pair your phone.";

export const Route = createFileRoute("/get-started")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
    ],
  }),
  component: GetStartedPage,
});

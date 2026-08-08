import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";

import appCss from "../styles.css?url";

const TITLE = "Mend — run your TUI agents anywhere you want";
const DESCRIPTION =
  "Run claude, codex, or any TUI coding agent in a recorded worktree on your own machine, and steer it from web or phone. Harness-agnostic sessions, one worktree per session, guided local review, a link per session. Open source, built on Sealant.";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="marketing-body">
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}

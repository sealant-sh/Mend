import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";

import appCss from "../styles.css?url";

const TITLE = "Mend";
const DESCRIPTION = "The queue, the brief, the run audit — Mend, by Sealant.";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { name: "robots", content: "noindex" },
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
      <body className="min-h-screen bg-background font-sans text-foreground">
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}

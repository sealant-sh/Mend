import { QueryClientProvider } from "@tanstack/react-query";
import type { ErrorComponentProps } from "@tanstack/react-router";
import {
  CatchBoundary,
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  useLocation,
} from "@tanstack/react-router";

import { queryClient } from "#/lib/queries";

import appCss from "../styles.css?url";

const TITLE = "Mend";
const DESCRIPTION = "Projects, sessions, and the review — the agent workbench, by Sealant.";

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

// One boundary above every page: a single failing query (one unreachable
// project, one expired session) degrades to this screen instead of a blank
// document. The reset key is the pathname, so navigating away recovers.
function RouteError({ error, reset }: ErrorComponentProps) {
  return (
    <main className="mx-auto max-w-lg px-6 py-24">
      <p className="font-mono text-[11px] tracking-wider text-faint uppercase">
        this page failed to load
      </p>
      <p className="mt-3 font-mono text-[12.5px] break-words text-muted-foreground">
        {error instanceof Error ? error.message : String(error)}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-xl border border-border bg-card px-3 py-1.5 font-sans text-xs font-medium text-foreground shadow-xs transition-transform hover:-translate-y-0.5"
      >
        Try again
      </button>
    </main>
  );
}

function RootComponent() {
  const pathname = useLocation({ select: (location) => location.pathname });
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground">
        <QueryClientProvider client={queryClient}>
          <CatchBoundary getResetKey={() => pathname} errorComponent={RouteError}>
            <Outlet />
          </CatchBoundary>
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}

import { QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, Outlet } from "@tanstack/react-router";

import { loadConnection } from "#/lib/connection";
import { queryClient } from "#/lib/queries";

/**
 * One window, two screens: the cockpit, and the connect screen for the
 * optional Mend server. Herdr is local and needs no credential, so the
 * cockpit always renders; the Mend half of it appears once signed in.
 */
export const Route = createRootRoute({
  // Resolve the connection once before anything renders so no screen has to
  // wait on it.
  beforeLoad: () => loadConnection(),
  component: RootComponent,
});

function RootComponent() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="relative flex h-full flex-col overflow-hidden bg-background text-foreground">
        <Outlet />
      </div>
    </QueryClientProvider>
  );
}

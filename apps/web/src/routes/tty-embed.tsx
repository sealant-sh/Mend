import { createFileRoute } from "@tanstack/react-router";

import { SessionTerminal } from "#/components/terminal";

export const Route = createFileRoute("/tty-embed")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    session: typeof search["session"] === "string" ? search["session"] : "",
    token: typeof search["token"] === "string" ? search["token"] : "",
  }),
  component: TtyEmbed,
});

/**
 * The terminal alone, edge to edge — what the mobile app's WebView shows.
 * Auth is the bearer passed by the app; the WS route accepts ?token= because
 * WebSocket clients cannot set headers. No shell, no nav: one surface.
 */
function TtyEmbed() {
  const { session, token } = Route.useSearch();
  if (session === "") return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--sw-panel)" }}>
      <SessionTerminal key={session} sessionId={session} token={token} />
    </div>
  );
}

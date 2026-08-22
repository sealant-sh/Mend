import { createFileRoute } from "@tanstack/react-router";

import { SessionTerminal } from "#/components/terminal";

export const Route = createFileRoute("/tty-embed")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    session: typeof search["session"] === "string" ? search["session"] : "",
    process: typeof search["process"] === "string" ? search["process"] : undefined,
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
  const { session, process, token } = Route.useSearch();
  if (session === "") return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--sw-panel)" }}>
      <SessionTerminal
        key={process ?? session}
        sessionId={session}
        {...(process === undefined ? {} : { processId: process })}
        token={token}
      />
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { appRouter } from "../server/routers/index.ts";

/**
 * The tRPC surface as a Start SERVER route: nitro bundles and serves it with
 * the app, so /trpc exists wherever the app runs — vite dev, the nitro
 * output, the combined single-host image — with no separate host process.
 * Procedures forward to the API (MEND_API_URL) with the caller's credentials.
 */
const handler = ({ request }: { readonly request: Request }) =>
  fetchRequestHandler({
    endpoint: "/trpc",
    req: request,
    router: appRouter,
    createContext: () => ({
      headers: request.headers,
      apiUrl: new URL(process.env["MEND_API_URL"] ?? "http://localhost:3101").origin,
    }),
  });

export const Route = createFileRoute("/trpc/$")({
  server: {
    handlers: {
      GET: handler,
      POST: handler,
    },
  },
});

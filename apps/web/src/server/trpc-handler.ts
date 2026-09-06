import { isAllowedOrigin, type PublicNetwork } from "@mend/network";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { appRouter } from "./routers/index.ts";

/**
 * Validate the browser's source request before any procedure runs. The API also
 * receives Origin unchanged, so server transport cannot launder cookie authority.
 * Native callers without cookies or Origin still use the usual authentication.
 */
export const createTrpcHandler =
  (options: {
    readonly network: PublicNetwork;
    readonly apiUrl: string;
  }): ((request: Request) => Promise<Response>) =>
  async (request) => {
    const origin = request.headers.get("origin");
    if (
      origin === null
        ? request.method !== "GET" && request.headers.has("cookie")
        : !isAllowedOrigin(options.network, origin)
    ) {
      return new Response("Origin not allowed", { status: 403 });
    }
    return fetchRequestHandler({
      endpoint: "/trpc",
      req: request,
      router: appRouter,
      createContext: () => ({ headers: request.headers, apiUrl: options.apiUrl }),
    });
  };

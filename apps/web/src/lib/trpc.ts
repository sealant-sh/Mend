import { redirect } from "@tanstack/react-router";
import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";

import type { AppRouter } from "../server/router.ts";

/**
 * The UI's one client of the web tier's tRPC surface. Same origin — the web
 * server hosts /trpc and forwards to the API with this browser's cookies.
 */
export const trpc = createTRPCClient<AppRouter>({
  // Same origin: cookies ride along under the default same-origin credentials.
  links: [httpBatchLink({ url: "/trpc" })],
});

/** Map the API's 401 (surfaced as UNAUTHORIZED) to the login redirect, like `request` did. */
export const orLogin = async <A>(promise: Promise<A>): Promise<A> => {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof TRPCClientError && error.data?.code === "UNAUTHORIZED") {
      throw redirect({ to: "/login" });
    }
    throw error;
  }
};

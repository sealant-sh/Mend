import type { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import { createTRPCContext, createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import superjson from "superjson";

import type { AppRouter } from "../server/routers/index.ts";

/**
 * The UI's one client of the web tier's tRPC surface. Same origin — the web
 * server hosts /trpc and forwards to the API with this browser's cookies.
 * superjson matches the server's transformer, so Dates, bigints and branded
 * ids arrive as themselves.
 */
/**
 * In the browser this is same-origin; during server rendering there is no
 * origin to be relative to, so point at this web server's own port — a route
 * that forgets `ssr: false` gets a working loader instead of a crash.
 */
const trpcUrl =
  typeof window === "undefined"
    ? `http://localhost:${process.env["PORT"] ?? "3105"}/trpc`
    : "/trpc";

export const trpcClient = createTRPCClient<AppRouter>({
  // maxURLLength keeps big batched GETs (many ids on one screen) from
  // overflowing URL limits — tRPC splits the batch instead.
  links: [httpBatchLink({ url: trpcUrl, transformer: superjson, maxURLLength: 2083 })],
});

/** Hook-side access (components): `const trpc = useTRPC()` → queryOptions/mutationOptions. */
export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

/** Router-context access (loaders): built once per router beside its QueryClient. */
export const makeTrpcProxy = (queryClient: QueryClient) =>
  createTRPCOptionsProxy<AppRouter>({ client: trpcClient, queryClient });
export type TrpcProxy = ReturnType<typeof makeTrpcProxy>;

/**
 * Map a mutation's 401 (surfaced as UNAUTHORIZED) to the login walk. These
 * wrappers run from event handlers and menus — no loader is watching, so a
 * thrown TanStack `redirect()` would be inert; navigate directly and rethrow
 * so the caller's own error handling still sees the failure. Query-side 401s
 * are handled once at the QueryCache (router.tsx).
 */
export const orLogin = async <A>(promise: Promise<A>): Promise<A> => {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof TRPCClientError && error.data?.code === "UNAUTHORIZED") {
      if (typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.location.assign("/login");
      }
    }
    throw error;
  }
};

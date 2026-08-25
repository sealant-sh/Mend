import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
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
export const trpcClient = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: "/trpc", transformer: superjson })],
});

/** Hook-side access (components): `const trpc = useTRPC()` → queryOptions/mutationOptions. */
export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

/** Router-context access (loaders): built once per router beside its QueryClient. */
export const makeTrpcProxy = (queryClient: QueryClient) =>
  createTRPCOptionsProxy<AppRouter>({ client: trpcClient, queryClient });
export type TrpcProxy = ReturnType<typeof makeTrpcProxy>;

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

/** queryFn wrapper: an expired session on any page walks to /login instead of erroring. */
export const loggedIn =
  <A>(load: () => Promise<A>) =>
  (): Promise<A> =>
    orLogin(load());

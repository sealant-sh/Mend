import { makeMendApiClient, type MendApiClient } from "@mend/api-contracts";
import { Cause, Effect, Exit, ManagedRuntime, Option } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";

import { toTRPCError } from "./errors.ts";

export interface TrpcContext {
  /** The incoming request's headers — cookie/authorization forwarded to the API. */
  readonly headers: Headers;
  readonly apiUrl: string;
}

/** One fetch-backed runtime for every request; clients are per-request wiring only. */
const runtime = ManagedRuntime.make(FetchHttpClient.layer);

/** The caller's credentials ride along; nothing else does. */
const credentialHeaders = (headers: Headers): Record<string, string> => {
  const forwarded: Record<string, string> = {};
  const cookie = headers.get("cookie");
  const authorization = headers.get("authorization");
  if (cookie !== null) forwarded["cookie"] = cookie;
  if (authorization !== null) forwarded["authorization"] = authorization;
  return forwarded;
};

/** The contract-derived client, bound to this request's credentials. */
export const apiClientFor = (
  ctx: TrpcContext,
): Effect.Effect<MendApiClient, never, HttpClient.HttpClient> =>
  makeMendApiClient({
    baseUrl: ctx.apiUrl,
    transformClient: (client) =>
      HttpClient.mapRequest(client, HttpClientRequest.setHeaders(credentialHeaders(ctx.headers))),
  });

/**
 * One derived client per REQUEST, not per procedure: HttpApiClient.make walks
 * the whole contract eagerly (~4ms), and httpBatchLink puts many procedures
 * in one request. createContext makes one ctx object per request, so its
 * identity is the cache key; construction is pure wiring, so runSync is safe.
 */
const clients = new WeakMap<TrpcContext, MendApiClient>();
const clientOf = (ctx: TrpcContext): MendApiClient => {
  const cached = clients.get(ctx);
  if (cached !== undefined) return cached;
  const client = runtime.runSync(apiClientFor(ctx));
  clients.set(ctx, client);
  return client;
};

/**
 * Run one procedure body against the derived client. Failures the body did
 * not handle itself (outcome unions catch their own tags) become TRPCErrors
 * with the status the contract declares for them.
 */
export const run = async <A, E>(
  ctx: TrpcContext,
  use: (api: MendApiClient) => Effect.Effect<A, E>,
): Promise<A> => {
  const exit = await runtime.runPromiseExit(use(clientOf(ctx)));
  if (Exit.isSuccess(exit)) {
    // The client decodes into Schema.Class INSTANCES; superjson only walks
    // plain data, so Dates/bigints inside instances would dodge the
    // transformer and break JSON serialization. structuredClone flattens the
    // prototypes while keeping Dates and bigints as themselves.
    return exit.value === undefined ? exit.value : structuredClone(exit.value);
  }
  const failure = Cause.findErrorOption(exit.cause);
  throw toTRPCError(Option.isSome(failure) ? failure.value : Cause.squash(exit.cause));
};

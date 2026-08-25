import { errorStatusByTag } from "@mend/api-contracts";
import { TRPCError } from "@trpc/server";
import type { TRPC_ERROR_CODE_KEY } from "@trpc/server/unstable-core-do-not-import";

const codeForStatus = (status: number): TRPC_ERROR_CODE_KEY => {
  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 422:
      return "UNPROCESSABLE_CONTENT";
    case 429:
      return "TOO_MANY_REQUESTS";
    default:
      return status < 500 ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR";
  }
};

const hasTag = (error: unknown): error is { readonly _tag: string; readonly message?: string } =>
  typeof error === "object" && error !== null && "_tag" in error;

/**
 * One translation from an API-call failure to the tRPC wire. Contract errors
 * carry their status via the contract itself (errorStatusByTag); an undeclared
 * status surfaces as the HttpClientError's response status; a SchemaError is
 * contract drift and stays loud as a 500.
 */
export const toTRPCError = (error: unknown): TRPCError => {
  if (error instanceof TRPCError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (hasTag(error)) {
    const status = errorStatusByTag.get(error._tag);
    if (status !== undefined) {
      return new TRPCError({
        code: codeForStatus(status),
        message: message === "" ? error._tag : `${error._tag}: ${message}`,
      });
    }
    if (error._tag === "ResponseError") {
      const responseStatus = (error as { readonly response?: { readonly status?: number } })
        .response?.status;
      return new TRPCError({
        code: codeForStatus(responseStatus ?? 502),
        message,
      });
    }
    if (error._tag === "RequestError") {
      return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "mend api unreachable" });
    }
  }
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message, cause: error });
};

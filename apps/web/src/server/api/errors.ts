import { errorStatusByTag } from "@mend/api-contracts";
import { TRPCError } from "@trpc/server";
import { HttpClientError } from "effect/unstable/http";

type TrpcCode = ConstructorParameters<typeof TRPCError>[0]["code"];

const codeForStatus = (status: number): TrpcCode => {
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
 * carry their status via the contract itself (errorStatusByTag). Transport
 * failures (API process down) surface as a clean "unreachable" — never the
 * internal URL the client was dialing. An UNDECLARED response status keeps
 * its status so 401→login and friends still work; a DECLARED status whose
 * body no longer decodes is contract drift and stays a loud 500. Anything
 * else is logged server-side and crosses as a generic internal error.
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
  }
  if (HttpClientError.isHttpClientError(error)) {
    const reason = error.reason._tag;
    if (reason === "TransportError" || reason === "InvalidUrlError" || reason === "EncodeError") {
      return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "mend api unreachable" });
    }
    if (reason === "StatusCodeError") {
      // A status the contract DECLARES arrived, but its body failed the
      // contract's decode — drift between tiers must stay loud.
      console.error("[trpc] contract drift decoding API response:", message);
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "contract drift decoding the API response",
      });
    }
    const responseStatus = error.response?.status;
    return new TRPCError({
      code: codeForStatus(responseStatus ?? 502),
      message: `mend api responded ${responseStatus ?? "with no status"}`,
    });
  }
  // Unmapped failure or defect: keep the detail on the server, not the wire.
  console.error("[trpc] unmapped failure:", error);
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "internal error" });
};

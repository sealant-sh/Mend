import type * as http from "node:http";

/** Request facts the web proxy forwards to its internal app and API servers. */
export interface ProxyRequestMetadata {
  /** Headers received from the client-facing connection. */
  readonly headers: http.IncomingHttpHeaders;
  /** Address observed on that connection. */
  readonly remoteAddress: string | undefined;
}

/**
 * Keep same-origin request headers while removing client-written address metadata.
 * The client chain remains only for rate limiting, with this proxy's observation appended.
 */
export const forwardHeaders = (request: ProxyRequestMetadata): http.OutgoingHttpHeaders => {
  const priorFor = request.headers["x-forwarded-for"];
  const headers: http.OutgoingHttpHeaders = { ...request.headers };
  delete headers["forwarded"];
  delete headers["x-forwarded-host"];
  delete headers["x-forwarded-proto"];
  return {
    ...headers,
    "x-forwarded-for": [
      Array.isArray(priorFor) ? priorFor.join(", ") : priorFor,
      request.remoteAddress,
    ]
      .filter(Boolean)
      .join(", "),
  };
};

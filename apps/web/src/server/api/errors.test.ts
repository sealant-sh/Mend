import { once } from "node:events";
import { createServer, type Server } from "node:http";

import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { run } from "./run.ts";

/**
 * Drives run() + toTRPCError through the REAL derived client against a stub
 * API, so the HttpClientError tag names this layer branches on can never
 * silently drift with an effect upgrade again (they already did once: v3's
 * "ResponseError"/"RequestError" don't exist in v4).
 */

let server: Server;
let port = 0;
let mode: "unreachable" | "http-503" | "http-401" = "http-503";

beforeAll(async () => {
  server = createServer((_request, response) => {
    if (mode === "http-503") {
      response.writeHead(503, { "content-type": "text/plain" });
      response.end("busy");
      return;
    }
    response.writeHead(401, { "content-type": "application/json" });
    response.end("{}");
  });
  server.listen(0);
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  port = address.port;
});

afterAll(() => {
  server.close();
});

const ctxFor = (apiUrl: string) => ({ headers: new Headers(), apiUrl });

const failure = async (apiUrl: string): Promise<TRPCError> => {
  try {
    await run(ctxFor(apiUrl), (api) => api.health.status());
  } catch (error) {
    if (error instanceof TRPCError) return error;
    throw error;
  }
  throw new Error("expected the call to fail");
};

describe("run + toTRPCError against a real client", () => {
  it("an unreachable API is a clean 'unreachable', never the internal URL", async () => {
    const error = await failure("http://127.0.0.1:1");
    expect(error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(error.message).toBe("mend api unreachable");
    expect(error.message).not.toContain("127.0.0.1");
  });

  it("an undeclared 503 keeps its 5xx shape without leaking request details", async () => {
    mode = "http-503";
    const error = await failure(`http://127.0.0.1:${port}`);
    expect(error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(error.message).toBe("mend api responded 503");
  });

  it("an undeclared 401 maps to UNAUTHORIZED so the login walk still fires", async () => {
    mode = "http-401";
    const error = await failure(`http://127.0.0.1:${port}`);
    expect(error.code).toBe("UNAUTHORIZED");
  });
});

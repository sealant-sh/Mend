import { createReadStream, existsSync, statSync } from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { pipeline, Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { appRouter } from "../server/router.ts";

/**
 * The web server (ARCHITECTURE.md §2): the TanStack Start app plus a
 * transparent proxy for everything under `/api` to the Mend API server
 * (`apps/api`, MEND_API_URL). This process is deliberately stateless — no
 * database, no engine, no sessions — so it can be replicated freely; every
 * stateful concern lives behind the proxy. Browsers keep one origin: pages
 * and `/api/*` come from the same port, exactly as when one process served
 * both.
 *
 * The proxy is hand-rolled on `node:http` because it must carry three
 * shapes faithfully and dependency-free: plain requests, server-sent event
 * streams (no buffering), and WebSocket upgrades (`/api/tty`, the service
 * tunnel, the keys bridge) — the `upgrade` event with both sockets piped
 * raw.
 */

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const port = Number(process.env["PORT"] ?? "3105");
const apiUrl = new URL(process.env["MEND_API_URL"] ?? "http://localhost:3101");

const contentTypeFor = (file: string): string => {
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".map": "application/json",
    ".txt": "text/plain",
    ".webmanifest": "application/manifest+json",
  };
  return types[path.extname(file)] ?? "application/octet-stream";
};

// ─── The built app: static assets + SSR ─────────────────────────────────────
const clientDir = path.join(appDir, "dist/client");
const ssrEntry = path.join(appDir, "dist/server/server.js");
const ssr: { readonly fetch: (request: Request) => Promise<Response> } | null = existsSync(ssrEntry)
  ? (
      (await import(pathToFileURL(ssrEntry).href)) as {
        readonly default: { readonly fetch: (request: Request) => Promise<Response> };
      }
    ).default
  : null;
if (ssr === null) {
  console.warn("[web] no built app found (dist/server/server.js) — proxying /api only");
}

/**
 * Relay a web `Response` onto the node response. `Headers.entries()` folds
 * multiple set-cookie values into one comma-joined string — which breaks
 * cookies, whose values contain commas (Expires) — so set-cookie rides as
 * the array `getSetCookie()` preserves.
 */
const writeWebResponse = (webResponse: Response, response: http.ServerResponse): void => {
  const headers: http.OutgoingHttpHeaders = {};
  for (const [name, value] of webResponse.headers.entries()) {
    if (name !== "set-cookie") headers[name] = value;
  }
  const cookies = webResponse.headers.getSetCookie();
  if (cookies.length > 0) headers["set-cookie"] = cookies;
  response.writeHead(webResponse.status, headers);
  if (webResponse.body === null) {
    response.end();
    return;
  }
  pipeline(
    Readable.fromWeb(webResponse.body as unknown as import("node:stream/web").ReadableStream),
    response,
    () => {},
  );
};

// ─── tRPC: the UI's typed surface; procedures forward to the API ────────────
const handleTrpc = async (
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) for (const item of value) headers.append(name, item);
  }
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const webRequest = new Request(new URL(request.url ?? "/", "http://mend.local"), {
    method: request.method,
    headers,
    ...(hasBody ? { body: Readable.toWeb(request) as unknown as BodyInit, duplex: "half" } : {}),
  } as RequestInit);
  const webResponse = await fetchRequestHandler({
    endpoint: "/trpc",
    req: webRequest,
    router: appRouter,
    createContext: () => ({ headers, apiUrl: apiUrl.origin }),
  });
  writeWebResponse(webResponse, response);
};

const hopByHop = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/**
 * Standard forwarded headers for both proxy paths. proto passes through an
 * upstream TLS terminator's value; the client address is APPENDED to
 * x-forwarded-for (never trusted verbatim) so the API can take the last,
 * proxy-written entry.
 */
const forwardHeaders = (request: http.IncomingMessage): http.OutgoingHttpHeaders => {
  const proto = request.headers["x-forwarded-proto"];
  const priorFor = request.headers["x-forwarded-for"];
  return {
    ...request.headers,
    // The API sees the proxy's hostname otherwise; keep the client's.
    "x-forwarded-host": request.headers.host ?? "",
    "x-forwarded-proto": typeof proto === "string" && proto !== "" ? proto : "http",
    "x-forwarded-for": [
      Array.isArray(priorFor) ? priorFor.join(", ") : priorFor,
      request.socket.remoteAddress,
    ]
      .filter(Boolean)
      .join(", "),
  };
};

/** Forward one request to the API verbatim; stream both directions, never buffer. */
const proxyRequest = (request: http.IncomingMessage, response: http.ServerResponse): void => {
  const upstream = http.request(
    {
      host: apiUrl.hostname,
      port: apiUrl.port,
      method: request.method,
      path: request.url,
      headers: forwardHeaders(request),
    },
    (upstreamResponse) => {
      const headers = Object.fromEntries(
        Object.entries(upstreamResponse.headers).filter(([name]) => !hopByHop.has(name)),
      );
      response.writeHead(upstreamResponse.statusCode ?? 502, headers);
      pipeline(upstreamResponse, response, () => {});
    },
  );
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain" });
    response.end("mend api unreachable");
  });
  pipeline(request, upstream, () => {});
};

const server = http.createServer((request, response) => {
  const url = request.url ?? "/";
  if (url === "/api" || url.startsWith("/api/")) {
    proxyRequest(request, response);
    return;
  }
  if (url === "/trpc" || url.startsWith("/trpc/")) {
    handleTrpc(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
    return;
  }

  void (async () => {
    if (request.method === "GET" || request.method === "HEAD") {
      const pathname = new URL(url, "http://mend.local").pathname;
      const candidate = path.join(clientDir, pathname);
      const insideClientDir = candidate.startsWith(clientDir + path.sep);
      if (insideClientDir && existsSync(candidate) && statSync(candidate).isFile()) {
        response.writeHead(200, { "content-type": contentTypeFor(candidate) });
        pipeline(createReadStream(candidate), response, () => {});
        return;
      }
    }
    if (ssr === null) {
      response.writeHead(503, { "content-type": "text/plain" });
      response.end("web app not built");
      return;
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === "string") headers.set(name, value);
      else if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    }
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const webRequest = new Request(new URL(url, `http://${request.headers.host ?? "mend.local"}`), {
      method: request.method,
      headers,
      // Node's web-stream types and the DOM lib's are structurally identical twins
      // that TypeScript keeps distinct; the casts bridge them and nothing else.
      ...(hasBody ? { body: Readable.toWeb(request) as unknown as BodyInit, duplex: "half" } : {}),
    } as RequestInit);
    const webResponse = await ssr.fetch(webRequest);
    writeWebResponse(webResponse, response);
  })().catch(() => {
    if (!response.headersSent) response.writeHead(500);
    response.end();
  });
});

// ─── WebSocket upgrades: pipe both sockets raw, verbatim ────────────────────

/**
 * Rebuild the upstream's header block from rawHeaders — repeats (set-cookie)
 * survive. The 101 path relays verbatim (Connection/Upgrade are the point and
 * there is no body); the plain-response path must DROP hop-by-hop headers:
 * node already de-chunked the body, so relaying `transfer-encoding: chunked`
 * over decoded bytes is broken framing — `connection: close` + EOF delimits
 * the body instead.
 */
const rawHeaderBlock = (
  upstreamResponse: http.IncomingMessage,
  options: { readonly stripHopByHop: boolean },
): string => {
  let lines = "";
  for (let k = 0; k + 1 < upstreamResponse.rawHeaders.length; k += 2) {
    const name = upstreamResponse.rawHeaders[k] ?? "";
    if (options.stripHopByHop && hopByHop.has(name.toLowerCase())) continue;
    lines += `${name}: ${upstreamResponse.rawHeaders[k + 1]}\r\n`;
  }
  if (options.stripHopByHop) lines += "connection: close\r\n";
  return lines;
};

server.on("upgrade", (request, socket, head) => {
  const url = request.url ?? "/";
  if (!(url === "/api" || url.startsWith("/api/"))) {
    socket.destroy();
    return;
  }
  const upstream = http.request({
    host: apiUrl.hostname,
    port: apiUrl.port,
    method: request.method,
    path: url,
    headers: forwardHeaders(request),
  });
  // Node hands the detached socket to this listener with NO error handling of
  // its own: a client reset before the API answers would otherwise be an
  // uncaught 'error' and take down the whole web tier.
  let upstreamAnswered = false;
  socket.on("error", () => upstream.destroy());
  socket.on("close", () => {
    if (!upstreamAnswered) upstream.destroy();
  });
  upstream.on("upgrade", (upstreamResponse, upstreamSocket, upstreamHead) => {
    upstreamAnswered = true;
    const statusLine = `HTTP/1.1 ${upstreamResponse.statusCode ?? 101} ${upstreamResponse.statusMessage ?? "Switching Protocols"}\r\n`;
    socket.write(statusLine + rawHeaderBlock(upstreamResponse, { stripHopByHop: false }) + "\r\n");
    if (upstreamHead.length > 0) socket.write(upstreamHead);
    if (head.length > 0) upstreamSocket.write(head);
    pipeline(socket, upstreamSocket, () => {});
    pipeline(upstreamSocket, socket, () => {});
  });
  // The API answered without upgrading (401, 404, ...): relay it as HTTP.
  upstream.on("response", (upstreamResponse) => {
    upstreamAnswered = true;
    const statusLine = `HTTP/1.1 ${upstreamResponse.statusCode ?? 502} ${upstreamResponse.statusMessage ?? ""}\r\n`;
    socket.write(statusLine + rawHeaderBlock(upstreamResponse, { stripHopByHop: true }) + "\r\n");
    pipeline(upstreamResponse, socket, () => {});
  });
  upstream.on("error", () => socket.destroy());
  upstream.end();
});

server.listen(port, () => {
  console.log(`[web] listening on :${port} · proxying /api to ${apiUrl.origin}`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    server.close();
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

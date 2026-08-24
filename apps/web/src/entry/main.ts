import { createReadStream, existsSync, statSync } from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { pipeline, Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

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

/** Forward one request to the API verbatim; stream both directions, never buffer. */
const proxyRequest = (request: http.IncomingMessage, response: http.ServerResponse): void => {
  const upstream = http.request(
    {
      host: apiUrl.hostname,
      port: apiUrl.port,
      method: request.method,
      path: request.url,
      headers: {
        ...request.headers,
        // The API sees the proxy's hostname otherwise; keep the client's.
        "x-forwarded-host": request.headers.host ?? "",
        "x-forwarded-proto": "http",
      },
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
    response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers.entries()));
    if (webResponse.body === null) {
      response.end();
      return;
    }
    pipeline(
      Readable.fromWeb(webResponse.body as unknown as import("node:stream/web").ReadableStream),
      response,
      () => {},
    );
  })().catch(() => {
    if (!response.headersSent) response.writeHead(500);
    response.end();
  });
});

// ─── WebSocket upgrades: pipe both sockets raw, verbatim ────────────────────
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
    headers: request.headers,
  });
  upstream.on("upgrade", (upstreamResponse, upstreamSocket, upstreamHead) => {
    const statusLine = `HTTP/1.1 ${upstreamResponse.statusCode ?? 101} ${upstreamResponse.statusMessage ?? "Switching Protocols"}\r\n`;
    const headerLines = Object.entries(upstreamResponse.headers)
      .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(", ") : value}\r\n`)
      .join("");
    socket.write(statusLine + headerLines + "\r\n");
    if (upstreamHead.length > 0) socket.write(upstreamHead);
    if (head.length > 0) upstreamSocket.write(head);
    pipeline(socket, upstreamSocket, () => {});
    pipeline(upstreamSocket, socket, () => {});
  });
  // The API answered without upgrading (401, 404, ...): relay it as HTTP.
  upstream.on("response", (upstreamResponse) => {
    const statusLine = `HTTP/1.1 ${upstreamResponse.statusCode ?? 502} ${upstreamResponse.statusMessage ?? ""}\r\n`;
    const headerLines = Object.entries(upstreamResponse.headers)
      .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(", ") : value}\r\n`)
      .join("");
    socket.write(statusLine + headerLines + "\r\n");
    pipeline(upstreamResponse, socket, () => {});
  });
  upstream.on("error", () => socket.destroy());
  upstream.end(head.length > 0 ? undefined : undefined);
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

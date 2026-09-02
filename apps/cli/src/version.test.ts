import { once } from "node:events";
import { createServer } from "node:http";

import { describe, expect, it } from "vitest";

import { cliVersion, fetchServerVersion, versionLines } from "./version.ts";

describe("cliVersion", () => {
  it("is the package's published version", async () => {
    const pkg = (await import("../package.json", { with: { type: "json" } })) as {
      readonly default: { readonly version: string };
    };
    expect(cliVersion()).toBe(pkg.default.version);
  });
});

describe("versionLines", () => {
  it("prints both versions and nothing more when they match", () => {
    expect(versionLines("0.17.0", { url: "http://m:3105", version: "0.17.0" })).toEqual([
      "mend 0.17.0",
      "server 0.17.0 · http://m:3105",
    ]);
  });

  it("notes a mismatch as a fact", () => {
    expect(versionLines("0.17.0", { url: "http://m:3105", version: "0.16.0" })).toEqual([
      "mend 0.17.0",
      "server 0.16.0 · http://m:3105",
      "versions differ — the server's API wins",
    ]);
  });

  it("states an absent server instead of failing", () => {
    expect(versionLines("0.17.0", { url: "http://m:3105", version: null })).toEqual([
      "mend 0.17.0",
      "server · unreachable · http://m:3105",
    ]);
  });
});

describe("fetchServerVersion", () => {
  it("reads the health route's version", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok", version: "0.17.0" }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing test port");
    const url = `http://127.0.0.1:${address.port}`;
    try {
      expect(await fetchServerVersion(url)).toEqual({ url, version: "0.17.0" });
    } finally {
      server.close();
    }
  });

  it("answers null for a server that is not there, within the timeout", async () => {
    const started = Date.now();
    // Port 9 (discard) is closed on any sane machine; the refusal is immediate.
    expect(await fetchServerVersion("http://127.0.0.1:9", 1_000)).toEqual({
      url: "http://127.0.0.1:9",
      version: null,
    });
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

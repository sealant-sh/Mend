import { spawn } from "node:child_process";
import { once } from "node:events";
import * as fs from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { chooseUrl, groupCode, minutesUntil, pairingLink } from "./pair.ts";

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

const startFakeMend = async (handle: Handler) => {
  const server = createServer(handle);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("missing test port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
};

/** The CLI as a user runs it, with a home of its own so the machine's own config cannot leak in. */
const runCli = async (
  url: string,
  args: ReadonlyArray<string>,
  options: { readonly token?: string } = {},
) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mend-pair-test-"));
  const entrypoint = fileURLToPath(new URL("./main.ts", import.meta.url));
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, "config"),
    MEND_URL: url,
    MEND_DETACH_KEY: "none",
    MEND_TOKEN: options.token,
  };
  const child = spawn(process.execPath, ["--experimental-strip-types", entrypoint, ...args], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const [code] = await once(child, "exit");
  return { code: typeof code === "number" ? code : null, stdout, stderr };
};

describe("pairing facts", () => {
  it("groups the code the way it is read aloud", () => {
    expect(groupCode("ABCDEFGH")).toBe("ABCD-EFGH");
    expect(groupCode("abcd-efgh")).toBe("ABCD-EFGH");
  });

  it("encodes the base URL into the deep link", () => {
    expect(pairingLink("http://100.64.1.2:3105", "ABCDEFGH")).toBe(
      "mend://pair?u=http%3A%2F%2F100.64.1.2%3A3105&c=ABCDEFGH",
    );
  });

  it("prefers the tailnet address, then the first candidate, then --url over both", () => {
    const urls = ["http://192.168.1.5:3105", "http://100.64.1.2:3105"];
    expect(chooseUrl(urls, null)).toBe("http://100.64.1.2:3105");
    expect(chooseUrl(["http://192.168.1.5:3105"], null)).toBe("http://192.168.1.5:3105");
    expect(chooseUrl(urls, "http://mend.local:3105")).toBe("http://mend.local:3105");
    expect(chooseUrl([], null)).toBeNull();
  });

  it("reports whole minutes left, and nothing at all for an unreadable date", () => {
    const now = Date.parse("2026-08-22T10:00:00.000Z");
    expect(minutesUntil("2026-08-22T10:10:00.000Z", now)).toBe(10);
    expect(minutesUntil("2026-08-22T09:00:00.000Z", now)).toBe(0);
    expect(minutesUntil("not a date", now)).toBeNull();
  });
});

describe("mend pair", () => {
  it("prints the QR, the grouped code, the chosen URL, and when it expires", async () => {
    const requests: Array<string> = [];
    const fake = await startFakeMend((request, response) => {
      requests.push(`${request.method ?? ""} ${request.url ?? ""}`);
      if (request.url === "/api/me/devices/pairings") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            code: "ABCDEFGH",
            expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
            urls: ["http://192.168.1.5:3105", "http://100.64.1.2:3105"],
          }),
        );
        return;
      }
      response.writeHead(404).end();
    });

    try {
      const result = await runCli(fake.url, ["pair"], { token: "test-token" });
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(requests).toEqual(["POST /api/me/devices/pairings"]);
      // The QR renders as block characters, on a pipe as well as in a terminal.
      expect(result.stdout).toContain("▄");
      expect(result.stdout).toContain("ABCD-EFGH");
      expect(result.stdout).toContain("http://100.64.1.2:3105");
      expect(result.stdout).toContain("in 10 min");
      expect(result.stdout).toContain("enter the url and the code");
    } finally {
      await fake.close();
    }
  });

  it("fails the way every other authenticated command fails when nobody is signed in", async () => {
    const fake = await startFakeMend((_request, response) => {
      response.writeHead(401).end();
    });

    try {
      const result = await runCli(fake.url, ["pair"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toBe(`mend: not signed in to ${fake.url} — run: mend login\n`);
      expect(result.stdout).toBe("");
    } finally {
      await fake.close();
    }
  });
});

import { spawn } from "node:child_process";
import { once } from "node:events";
import * as fs from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { formatCheck } from "./doctor.ts";

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

const account = (provider: string, login: string) => ({
  id: `account-${provider}`,
  provider,
  name: "default",
  kind: "oauth",
  status: "active",
  metadata: { login },
  connectedAt: new Date(0).toISOString(),
  lastUsedAt: null,
});

/** A machine where every local fact is already true: the three CLIs, with credentials. */
const readyMachine = () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mend-doctor-test-"));
  const bin = path.join(home, "bin");
  fs.mkdirSync(bin, { recursive: true });
  for (const command of ["claude", "codex", "gh"]) {
    const file = path.join(bin, command);
    // `gh auth token` is how main.ts reads the GitHub credential; the others are read from disk.
    fs.writeFileSync(file, "#!/bin/sh\necho gho_testtoken\n");
    fs.chmodSync(file, 0o755);
  }
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", ".credentials.json"), "{}");
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(home, ".codex", "auth.json"), "{}");
  return { home, bin };
};

const runDoctor = async (
  url: string,
  options: { readonly token?: string; readonly ready?: boolean } = {},
) => {
  const machine =
    options.ready === true
      ? readyMachine()
      : { home: fs.mkdtempSync(path.join(os.tmpdir(), "mend-doctor-test-")), bin: null };
  const entrypoint = fileURLToPath(new URL("./main.ts", import.meta.url));
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: machine.home,
    XDG_CONFIG_HOME: path.join(machine.home, "config"),
    // The provider CLIs read these before HOME; the test machine owns both.
    CLAUDE_CONFIG_DIR: path.join(machine.home, ".claude"),
    CODEX_HOME: path.join(machine.home, ".codex"),
    PATH:
      machine.bin === null
        ? (process.env["PATH"] ?? "")
        : `${machine.bin}${path.delimiter}${process.env["PATH"] ?? ""}`,
    MEND_URL: url,
    MEND_DETACH_KEY: "none",
    MEND_TOKEN: options.token,
  };
  const child = spawn(process.execPath, ["--experimental-strip-types", entrypoint, "doctor"], {
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

const greenServer = (request: IncomingMessage, response: ServerResponse): void => {
  const routes: Record<string, unknown> = {
    "/api/health": { status: "ok", version: "0.5.0" },
    "/api/projects": [{ id: "project-1", name: "fixture" }],
    "/api/sealant/connection": {
      status: "connected",
      baseUrl: "http://127.0.0.1:4000",
      detail: null,
      checkedAt: new Date(0).toISOString(),
    },
    "/api/me/sealant": {
      sealantUserId: "user-1",
      accounts: [
        account("claude", "you@example.com"),
        account("codex", "you@example.com"),
        account("github", "you"),
      ],
    },
    "/api/machine": {
      hostname: "fixture",
      platform: "linux",
      tailnet: { status: "reachable", address: "100.64.1.2" },
    },
  };
  const body = routes[request.url ?? ""];
  if (body === undefined) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

describe("status lines", () => {
  it("marks the state, pads the label, and ends on the command that fixes it", () => {
    expect(
      formatCheck({
        label: "codex",
        state: "todo",
        detail: "not connected",
        fix: "mend connect codex",
      }),
    ).toBe("○ codex       not connected → mend connect codex");
    expect(formatCheck({ label: "server", state: "ok", detail: "mend 0.5.0", fix: null })).toBe(
      "✓ server      mend 0.5.0",
    );
  });
});

describe("mend doctor", () => {
  it("reports every fact and exits 0 when the machine is set up", async () => {
    const fake = await startFakeMend(greenServer);
    try {
      const result = await runDoctor(fake.url, { token: "test-token", ready: true });
      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain("✗");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("✓ server      ");
      expect(result.stdout).toContain("✓ signed in   token accepted");
      expect(result.stdout).toContain("✓ sealant     connected · http://127.0.0.1:4000");
      expect(result.stdout).toContain("✓ claude      connected · you@example.com");
      expect(result.stdout).toContain("✓ projects    1 adopted");
      expect(result.stdout).toContain("✓ claude cli  on PATH · credential present");
      expect(result.stdout).toContain("✓ gh cli      on PATH · credential present");
      expect(result.stdout).toContain("✓ tailnet     100.64.1.2");
    } finally {
      await fake.close();
    }
  });

  it("exits 1 on a rejected token and says which command fixes it", async () => {
    const fake = await startFakeMend((request, response) => {
      if (request.url === "/api/projects") {
        response.writeHead(401).end();
        return;
      }
      greenServer(request, response);
    });
    try {
      const result = await runDoctor(fake.url, { token: "stale-token", ready: true });
      expect(result.stdout).toContain("✗ signed in   token rejected → mend login");
      expect(result.code).toBe(1);
      // A rejected token stops the reads that depend on it — nothing is guessed.
      expect(result.stdout).toContain("○ sealant     not checked");
      expect(result.stdout).toContain("○ tailnet     not checked");
    } finally {
      await fake.close();
    }
  });
});

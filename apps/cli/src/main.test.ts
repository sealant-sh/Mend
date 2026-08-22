import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const project = {
  id: "project-1",
  name: "fixture",
  originUrl: null,
  storePath: "/tmp/mend/fixture/repo.git",
  defaultBranch: "main",
};

const session = {
  id: "session-1234",
  projectId: project.id,
  harness: "codex",
  label: null,
  worktree: "session-1234",
  branch: "mend/session/session-1234",
  baseSha: "abc123",
  status: "running",
  summary: null,
  createdAt: new Date(0).toISOString(),
};

const json = (response: ServerResponse, value: unknown): void => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
};

const websocketTextFrame = (text: string): Buffer => {
  const payload = Buffer.from(text);
  if (payload.length >= 126) throw new Error("test frame must use the short WebSocket encoding");
  return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
};

const acceptWebSocket = (request: IncomingMessage, socket: Duplex): void => {
  const key = request.headers["sec-websocket-key"];
  if (typeof key !== "string") throw new Error("missing WebSocket key");
  const accept = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      "\r\n",
  );
};

type HttpHandler = (request: IncomingMessage, response: ServerResponse) => void;

const startFakeMend = async (handleHttp: HttpHandler) => {
  let notifyEndFrame: (() => void) | undefined;
  const endFrameSent = new Promise<void>((resolve) => {
    notifyEndFrame = resolve;
  });
  const upgradedSockets = new Set<Duplex>();
  const server = createServer(handleHttp);
  server.on("upgrade", (request, socket) => {
    upgradedSockets.add(socket);
    socket.once("close", () => upgradedSockets.delete(socket));
    acceptWebSocket(request, socket);
    socket.write(websocketTextFrame(JSON.stringify({ t: "end" })));
    notifyEndFrame?.();
    // Deliberately keep the transport open. Session lifecycle ended already;
    // transport teardown must not remain on the user's exit path.
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("missing test port");

  return {
    endFrameSent,
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      for (const socket of upgradedSockets) socket.destroy();
      server.close();
      await once(server, "close");
    },
  };
};

const startCli = (url: string, args: ReadonlyArray<string>) => {
  const entrypoint = fileURLToPath(new URL("./main.ts", import.meta.url));
  const child = spawn(process.execPath, ["--experimental-strip-types", entrypoint, ...args], {
    env: { ...process.env, MEND_URL: url, MEND_DETACH_KEY: "none" },
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
  const exited = new Promise<{ readonly kind: "exit"; readonly code: number | null }>((resolve) => {
    child.once("exit", (code) => resolve({ kind: "exit", code }));
  });
  return { child, exited, stdout: () => stdout, stderr: () => stderr };
};

const expectFastExit = async (
  exited: Promise<{ readonly kind: "exit"; readonly code: number | null }>,
  stderr: () => string,
) => {
  const outcome = await Promise.race([
    exited,
    new Promise<{ readonly kind: "timeout" }>((resolve) =>
      setTimeout(() => resolve({ kind: "timeout" }), 750),
    ),
  ]);
  expect(outcome, stderr()).toEqual({ kind: "exit", code: 0 });
};

describe("Mend CLI session exit", () => {
  it("returns on the terminal end frame without waiting for the socket to close", async () => {
    const fake = await startFakeMend((request, response) => {
      if (request.url === "/api/sessions") json(response, [session]);
      else response.writeHead(404).end();
    });
    const cli = startCli(fake.url, ["attach", "session-"]);

    try {
      await fake.endFrameSent;
      await expectFastExit(cli.exited, cli.stderr);
    } finally {
      cli.child.kill("SIGKILL");
      await fake.close();
    }
  });

  it("does no Mend API work after a freshly launched harness ends", async () => {
    let lifecycleEnded = false;
    const postEndRequests: Array<string> = [];
    const fake = await startFakeMend((request, response) => {
      const route = `${request.method ?? "GET"} ${request.url ?? ""}`;
      if (lifecycleEnded) {
        postEndRequests.push(route);
        return;
      }
      if (route === "GET /api/projects") json(response, [project]);
      else if (route === `POST /api/projects/${project.id}/sessions`) json(response, session);
      else if (route === `POST /api/sessions/${session.id}/launch`) json(response, session);
      else response.writeHead(404).end();
    });
    const cli = startCli(fake.url, ["codex", "--project", project.name]);

    try {
      await fake.endFrameSent;
      lifecycleEnded = true;
      await expectFastExit(cli.exited, cli.stderr);
      expect(postEndRequests).toEqual([]);
    } finally {
      cli.child.kill("SIGKILL");
      await fake.close();
    }
  });
});

describe("mend help", () => {
  it("sequences the start block first and still lists every command", async () => {
    const cli = startCli("http://127.0.0.1:1", ["help"]);
    await cli.exited;
    const help = cli.stdout();

    expect(help.indexOf("\nstart\n")).toBeGreaterThan(-1);
    expect(help.indexOf("\nstart\n")).toBeLessThan(help.indexOf("\neverything else\n"));
    // The start block is the first run, in order.
    const started = [
      "mend login",
      "mend connect",
      "mend adopt",
      "mend codex",
      "mend pair",
      "mend doctor",
    ];
    const positions = started.map((command) => help.indexOf(`  ${command}`));
    expect(positions).toEqual(positions.toSorted((a, b) => a - b));
    expect(positions[0]).toBeGreaterThan(help.indexOf("\nstart\n"));
    expect(positions.at(-1)).toBeLessThan(help.indexOf("\neverything else\n"));
    // Nothing was dropped on the way past the reorder.
    for (const command of [
      "mend logout",
      "mend keys init",
      "mend keys show",
      "mend keys share",
      "mend env load",
      "mend env show",
      "mend accounts",
      "mend dotfiles",
      "mend dotfiles sync",
      "mend run --",
      "mend attach",
      "mend shell",
      "mend service run",
      "mend service add",
      "mend service init",
      "mend service list",
      "mend service logs",
      "mend service restart",
      "mend service stop",
      "mend continue",
      "mend resume",
      "mend rejoin",
      "mend projects",
      "mend sessions",
      "mend status",
      "mend completions",
    ]) {
      expect(help, command).toContain(`  ${command}`);
    }
    // The installer's renderer stays out of the printed surface.
    expect(help).not.toContain("mend qr");
  });
});

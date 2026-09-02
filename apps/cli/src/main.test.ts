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

/**
 * What the fake terminal does when a client attaches: `end` sends the end
 * control frame (the session settled); `drop` severs the transport without
 * one (a server restart, a network cut); `hold` keeps the socket open silent
 * (a live session — signals decide the exit).
 */
const startFakeMend = async (
  handleHttp: HttpHandler,
  behavior: "end" | "drop" | "hold" = "end",
) => {
  let notifyEndFrame: (() => void) | undefined;
  const endFrameSent = new Promise<void>((resolve) => {
    notifyEndFrame = resolve;
  });
  let notifyUpgraded: (() => void) | undefined;
  const upgraded = new Promise<void>((resolve) => {
    notifyUpgraded = resolve;
  });
  let upgrades = 0;
  const upgradedSockets = new Set<Duplex>();
  const server = createServer(handleHttp);
  server.on("upgrade", (request, socket) => {
    upgrades += 1;
    upgradedSockets.add(socket);
    socket.once("close", () => upgradedSockets.delete(socket));
    acceptWebSocket(request, socket);
    notifyUpgraded?.();
    if (behavior === "end") {
      socket.write(websocketTextFrame(JSON.stringify({ t: "end" })));
      notifyEndFrame?.();
      // Deliberately keep the transport open. Session lifecycle ended already;
      // transport teardown must not remain on the user's exit path.
    } else if (behavior === "drop") {
      setTimeout(() => socket.destroy(), 50);
    }
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("missing test port");

  return {
    endFrameSent,
    upgraded,
    upgradeCount: () => upgrades,
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

/** Poll until the fake observed something — CI cold starts must not count against a race. */
const waitFor = async (predicate: () => boolean, timeoutMs = 15_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor: condition never became true");
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
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

describe("Mend CLI session selection", () => {
  const retained = (request: IncomingMessage, response: ServerResponse): boolean => {
    if (request.url?.startsWith("/api/sessions?retained") === true) {
      json(response, [session]);
      return true;
    }
    if (request.url === "/api/projects") {
      json(response, [project]);
      return true;
    }
    return false;
  };

  it("attach with no id takes the only session instead of a usage error", async () => {
    const fake = await startFakeMend((request, response) => {
      if (!retained(request, response)) response.writeHead(404).end();
    });
    const cli = startCli(fake.url, ["attach"]);

    try {
      await fake.endFrameSent;
      await expectFastExit(cli.exited, cli.stderr);
      expect(cli.stdout()).toContain("attaching to");
    } finally {
      cli.child.kill("SIGKILL");
      await fake.close();
    }
  });

  it("stop with no id stops the only session", async () => {
    const stopped: Array<string> = [];
    const fake = await startFakeMend((request, response) => {
      if (retained(request, response)) return;
      if (request.url === `/api/sessions/${session.id}/stop`) {
        stopped.push(session.id);
        json(response, session);
      } else response.writeHead(404).end();
    });
    const cli = startCli(fake.url, ["stop"]);

    try {
      await cli.exited;
      expect(stopped, cli.stderr()).toEqual([session.id]);
      expect(cli.stdout()).toContain("stopped");
    } finally {
      cli.child.kill("SIGKILL");
      await fake.close();
    }
  });

  it("names the command it could not disambiguate when no terminal can pick", async () => {
    const second = { ...session, id: "session-5678", worktree: "session-5678" };
    const fake = await startFakeMend((request, response) => {
      if (request.url?.startsWith("/api/sessions?retained") === true) {
        json(response, [session, second]);
      } else if (request.url === "/api/projects") json(response, [project]);
      else response.writeHead(404).end();
    });
    const cli = startCli(fake.url, ["attach"]);

    try {
      await cli.exited;
      expect(cli.stderr()).toContain("mend attach <session-id-prefix>");
    } finally {
      cli.child.kill("SIGKILL");
      await fake.close();
    }
  });
});

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

describe("Mend CLI session lifecycle", () => {
  const launchRoutes = (routes: Array<string>): HttpHandler => {
    return (request, response) => {
      const route = `${request.method ?? "GET"} ${request.url ?? ""}`;
      routes.push(route);
      if (route === "GET /api/projects") json(response, [project]);
      else if (route === "GET /api/settings") json(response, { backgroundSessions: false });
      else if (route === `POST /api/projects/${project.id}/sessions`) json(response, session);
      else if (route === `POST /api/sessions/${session.id}/launch`) json(response, session);
      else if (route === `POST /api/sessions/${session.id}/stop`) json(response, session);
      else response.writeHead(404).end();
    };
  };

  it("--detach launches without attaching and prints the reattach hint", async () => {
    const routes: Array<string> = [];
    const fake = await startFakeMend(launchRoutes(routes), "hold");
    const cli = startCli(fake.url, ["codex", "--project", project.name, "--detach"]);

    try {
      // The fast-exit race starts once the fake saw the launch land: the CLI's
      // cold start (node boot + type stripping) is CI-speed, not under test.
      await waitFor(() => routes.includes(`POST /api/sessions/${session.id}/launch`));
      await expectFastExit(cli.exited, cli.stderr);
      expect(fake.upgradeCount()).toBe(0);
      expect(routes).not.toContain("GET /api/settings"); // the flag decides — no read
      expect(cli.stdout()).toContain(`mend attach ${session.id.slice(0, 8)}`);
    } finally {
      cli.child.kill("SIGKILL");
      await fake.close();
    }
  });

  it("foreground: a SIGTERM mid-attach stops the session before exiting", async () => {
    const routes: Array<string> = [];
    const fake = await startFakeMend(launchRoutes(routes), "hold");
    const cli = startCli(fake.url, ["codex", "--project", project.name]);

    try {
      await fake.upgraded;
      cli.child.kill("SIGTERM");
      const outcome = await Promise.race([
        cli.exited,
        new Promise<{ readonly kind: "timeout" }>((resolve) =>
          setTimeout(() => resolve({ kind: "timeout" }), 4000),
        ),
      ]);
      expect(outcome, cli.stderr()).toEqual({ kind: "exit", code: 0 });
      expect(routes).toContain(`POST /api/sessions/${session.id}/stop`);
      expect(cli.stdout()).toContain("stopped");
    } finally {
      cli.child.kill("SIGKILL");
      await fake.close();
    }
  });

  it("foreground: the harness ending naturally sends no stop", async () => {
    const routes: Array<string> = [];
    const fake = await startFakeMend(launchRoutes(routes), "end");
    const cli = startCli(fake.url, ["codex", "--project", project.name]);

    try {
      await fake.endFrameSent;
      await expectFastExit(cli.exited, cli.stderr);
      expect(routes).not.toContain(`POST /api/sessions/${session.id}/stop`);
    } finally {
      cli.child.kill("SIGKILL");
      await fake.close();
    }
  });

  it("background: a dropped socket says the session keeps running, not that it ended", async () => {
    const fake = await startFakeMend((request, response) => {
      if (request.url === "/api/sessions") json(response, [session]);
      else response.writeHead(404).end();
    }, "drop");
    const cli = startCli(fake.url, ["attach", "session-"]);

    try {
      const outcome = await Promise.race([
        cli.exited,
        new Promise<{ readonly kind: "timeout" }>((resolve) =>
          setTimeout(() => resolve({ kind: "timeout" }), 4000),
        ),
      ]);
      expect(outcome, cli.stderr()).toEqual({ kind: "exit", code: 0 });
      expect(cli.stdout()).toContain("keeps running");
      expect(cli.stdout()).not.toContain("session ended");
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
    expect(help.indexOf("\nstart\n")).toBeLessThan(help.indexOf("\nsessions\n"));
    // The start block is the first run, in order.
    const started = ["login", "connect", "adopt", "codex", "pair", "doctor"];
    const positions = started.map((command) => help.indexOf(`\n  ${command} `));
    expect(positions).toEqual(positions.toSorted((a, b) => a - b));
    expect(positions[0]).toBeGreaterThan(help.indexOf("\nstart\n"));
    expect(positions.at(-1)).toBeLessThan(help.indexOf("\nsessions\n"));
    // Nothing was dropped on the way past the reorder.
    for (const command of [
      "logout",
      "keys init",
      "keys show",
      "keys share",
      "keys autoshare",
      "env load",
      "env show",
      "accounts",
      "dotfiles",
      "dotfiles sync",
      "run",
      "attach",
      "stop",
      "shell",
      "service run",
      "service add",
      "service init",
      "service list",
      "service logs",
      "service restart",
      "service stop",
      "continue",
      "resume",
      "rejoin",
      "projects",
      "sessions",
      "completions",
      "version",
    ]) {
      expect(help, command).toContain(`\n  ${command} `);
    }
    // The installer's renderer stays out of the printed surface.
    expect(help).not.toContain("  qr ");
  });

  it("prints one command's page for help <command> and <command> --help alike", async () => {
    const byHelp = startCli("http://127.0.0.1:1", ["help", "service", "run"]);
    const byFlag = startCli("http://127.0.0.1:1", ["service", "run", "--help"]);
    await Promise.all([byHelp.exited, byFlag.exited]);
    expect(byHelp.stdout()).toContain("mend service run · ");
    expect(byHelp.stdout()).toContain("--no-connect");
    expect(byFlag.stdout()).toBe(byHelp.stdout());
  });

  it("quotes the catalog's synopsis in a usage error", async () => {
    const cli = startCli("http://127.0.0.1:1", ["service", "stop"]);
    const outcome = await cli.exited;
    expect(outcome.code).toBe(1);
    expect(cli.stderr()).toContain("usage: mend service stop <name-or-id>");
  });
});

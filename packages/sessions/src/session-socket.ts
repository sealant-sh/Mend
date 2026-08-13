import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";

import type { SessionId } from "@mend/domain";
import { Effect, Layer } from "effect";
import * as Context from "effect/Context";

/**
 * The in-workspace control surface (docs/SESSION-SERVICES.md): one unix
 * socket PER SESSION, bind-mounted read-only at /run/mend inside that
 * session's workspace. Auth is the mount boundary — whoever can open the
 * socket IS the session; every verb it serves is already scoped to that one
 * session by construction, so there is no token to leak and nothing an agent
 * can reach beyond what its own terminal could already do.
 *
 * The host side is dumb infra: bind the socket, stage the `mend` helper
 * script beside it, route tiny JSON requests to the closures the engine
 * provides. The engine owns the semantics; this file owns the plumbing.
 *
 * Socket dirs live under the store (`~/.mend/store/_run/sessions/<id>`) —
 * already inside the platform's mount allowlist, `_`-prefixed like
 * `_references`. Paths are deterministic per session, so a Mend restart
 * re-binds the same path and the running workspace's mount comes back to
 * life without touching the container.
 */

/** What the engine serves over a session's socket — every closure pre-scoped. */
export interface SessionSocketApi {
  readonly recipes: () => Effect.Effect<unknown>;
  readonly listServices: () => Effect.Effect<unknown>;
  readonly runService: (
    argv: ReadonlyArray<string>,
    port: number,
    name: string | null,
    protocol?: "tcp" | "udp",
  ) => Effect.Effect<unknown>;
  readonly addService: (
    port: number,
    name: string | null,
    protocol?: "tcp" | "udp",
  ) => Effect.Effect<unknown>;
  readonly stopService: (processId: string) => Effect.Effect<unknown>;
  readonly restartService: (processId: string) => Effect.Effect<unknown>;
}

export class SessionSocketHost extends Context.Service<
  SessionSocketHost,
  {
    /** Bind (or re-bind) the session's socket + helper; resolves with the host dir to mount. */
    readonly start: (sessionId: SessionId, api: SessionSocketApi) => Effect.Effect<string>;
    /** Close the socket and remove the session's run dir. Idempotent. */
    readonly stop: (sessionId: SessionId) => Effect.Effect<void>;
  }
>()("@mend/sessions/SessionSocketHost") {}

const runRoot = (): string =>
  process.env["MEND_RUN_DIR"] ?? path.join(os.homedir(), ".mend", "store", "_run", "sessions");

/** In-container path of the mount — the helper hardcodes it. */
export const SESSION_SOCKET_MOUNT_PATH = "/run/mend";

/**
 * The helper staged beside the socket. Dependency-free node, talking HTTP
 * over the unix socket; the wire is the private pact between this script and
 * the routes below, versioned together because they ship together.
 */
const HELPER_SCRIPT = `#!/usr/bin/env node
// mend — the in-workspace helper. Talks to YOUR session over /run/mend/mend.sock.
const http = require("node:http");

const SOCKET = "/run/mend/mend.sock";

const request = (method, route, body) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: SOCKET, method, path: route, headers: { "content-type": "application/json" } },
      (res) => {
        let text = "";
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => {
          if (res.statusCode >= 400) {
            let message = text;
            try { message = JSON.parse(text).message ?? text; } catch {}
            reject(new Error(message));
            return;
          }
          resolve(text === "" ? null : JSON.parse(text));
        });
      },
    );
    req.on("error", () => reject(new Error("mend.sock is not answering — is the Mend server up?")));
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });

const fail = (message) => {
  process.stderr.write("mend: " + message + "\\n");
  process.exit(1);
};

const printService = (s) =>
  console.log(
    (s.label ?? s.id.slice(0, 8)).padEnd(12) +
      "  :" + (s.workspacePort ?? "?") + (s.protocol === "udp" ? "/udp" : "") +
      "  " + s.status +
      "  " + s.id.slice(0, 8),
  );

const main = async () => {
  const [group, verb, ...rest] = process.argv.slice(2);
  if (group !== "service") {
    fail("this workspace helper only speaks: mend service <run|add|list|stop|restart|NAME>");
  }
  try {
    switch (verb) {
      case "list":
      case undefined: {
        const services = await request("GET", "/services");
        if (services.length === 0) console.log("no live services");
        for (const s of services) printService(s);
        return;
      }
      case "run": {
        const dashdash = rest.indexOf("--");
        if (dashdash === -1) {
          // Recipe form: mend service run <name>
          const name = rest.find((a) => !a.startsWith("--"));
          if (name === undefined) {
            fail("usage: mend service run --port <p> [--name <n>] -- <command...> | mend service run <name>");
          }
          const recipes = await request("GET", "/recipes");
          const recipe = recipes.find((r) => r.name === name);
          if (recipe === undefined) {
            fail('no recipe named "' + name + '" — declared: ' + (recipes.map((r) => r.name).join(", ") || "none"));
          }
          const service = recipe.command === null
            ? await request("POST", "/services/add", { port: recipe.port, name: recipe.name, protocol: recipe.protocol })
            : await request("POST", "/services/run", { argv: ["sh", "-c", recipe.command], port: recipe.port, name: recipe.name, protocol: recipe.protocol });
          console.log("Service " + (service.label ?? "") + " · " + service.status + " · reachable from the user's machine");
          return;
        }
        const argv = rest.slice(dashdash + 1);
        const head = rest.slice(0, dashdash);
        const portFlag = head.indexOf("--port");
        const port = portFlag === -1 ? NaN : Number(head[portFlag + 1]);
        const nameFlag = head.indexOf("--name");
        const name = nameFlag === -1 ? null : (head[nameFlag + 1] ?? null);
        const protocol = head.includes("--udp") ? "udp" : "tcp";
        if (!Number.isInteger(port) || argv.length === 0) {
          fail("usage: mend service run --port <p> [--name <n>] [--udp] -- <command...>");
        }
        const service = await request("POST", "/services/run", { argv, port, name, protocol });
        console.log("Service " + (service.label ?? "") + " · " + service.status + " · reachable from the user's machine");
        return;
      }
      case "add": {
        const port = Number(rest.find((a) => /^\\d+$/.test(a)));
        const nameFlag = rest.indexOf("--name");
        const name = nameFlag === -1 ? null : (rest[nameFlag + 1] ?? null);
        const protocol = rest.includes("--udp") ? "udp" : "tcp";
        if (!Number.isInteger(port)) fail("usage: mend service add <port> [--name <n>] [--udp]");
        const service = await request("POST", "/services/add", { port, name, protocol });
        console.log("Service " + (service.label ?? "") + " · " + service.status);
        return;
      }
      case "stop":
      case "restart": {
        const needle = rest[0];
        if (needle === undefined) fail("usage: mend service " + verb + " <name-or-id>");
        const services = await request("GET", "/services");
        const match = services.find((s) => s.label === needle || s.id.startsWith(needle));
        if (match === undefined) fail('no live service matches "' + needle + '"');
        const done = await request("POST", "/services/" + match.id + "/" + verb);
        console.log(verb + "ped: " + (done.label ?? done.id.slice(0, 8)) + " · " + done.status);
        return;
      }
      default:
        fail('unknown service command "' + verb + '" — try: run, add, list, stop, restart');
    }
  } catch (error) {
    fail(error.message);
  }
};

// Bare-name sugar without recursion tricks: rewrite argv before dispatch.
const args = process.argv.slice(2);
if (args[0] === "service" && args[1] !== undefined &&
    !["run", "add", "list", "stop", "restart"].includes(args[1])) {
  process.argv = [...process.argv.slice(0, 3), "run", ...process.argv.slice(3)];
}
main();
`;

interface ActiveSocket {
  readonly server: http.Server;
}

const readBody = (request: http.IncomingMessage): Promise<unknown> =>
  new Promise((resolve) => {
    let text = "";
    request.on("data", (chunk) => {
      text += chunk;
    });
    request.on("end", () => {
      let parsed: unknown = {};
      if (text !== "") {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = {};
        }
      }
      resolve(parsed);
    });
  });

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

export const SessionSocketHostLive: Layer.Layer<SessionSocketHost> = Layer.effect(
  SessionSocketHost,
  Effect.gen(function* () {
    const active = new Map<SessionId, ActiveSocket>();

    const stopSync = (sessionId: SessionId): void => {
      const entry = active.get(sessionId);
      if (entry !== undefined) {
        active.delete(sessionId);
        entry.server.close();
      }
      fs.rmSync(path.join(runRoot(), sessionId), { recursive: true, force: true });
    };

    // Shutdown: close every socket or the process cannot exit gracefully.
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const sessionId of Array.from(active.keys())) {
          const entry = active.get(sessionId);
          active.delete(sessionId);
          entry?.server.close();
        }
      }),
    );

    const handle = async (
      api: SessionSocketApi,
      request: http.IncomingMessage,
      response: http.ServerResponse,
    ): Promise<void> => {
      const respond = (status: number, payload: unknown): void => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(payload));
      };
      const url = new URL(request.url ?? "/", "http://mend.sock");
      const route = `${request.method} ${url.pathname}`;
      try {
        if (route === "GET /recipes") return respond(200, await Effect.runPromise(api.recipes()));
        if (route === "GET /services")
          return respond(200, await Effect.runPromise(api.listServices()));
        if (route === "POST /services/run") {
          const body = asRecord(await readBody(request));
          const argv = Array.isArray(body["argv"]) ? body["argv"].map(String) : [];
          const port = Number(body["port"]);
          const name = typeof body["name"] === "string" ? body["name"] : null;
          const protocol = body["protocol"] === "udp" ? ("udp" as const) : ("tcp" as const);
          if (argv.length === 0 || !Number.isInteger(port)) {
            return respond(400, { message: "argv and port are required" });
          }
          return respond(200, await Effect.runPromise(api.runService(argv, port, name, protocol)));
        }
        if (route === "POST /services/add") {
          const body = asRecord(await readBody(request));
          const port = Number(body["port"]);
          const name = typeof body["name"] === "string" ? body["name"] : null;
          const protocol = body["protocol"] === "udp" ? ("udp" as const) : ("tcp" as const);
          if (!Number.isInteger(port)) return respond(400, { message: "port is required" });
          return respond(200, await Effect.runPromise(api.addService(port, name, protocol)));
        }
        const action = /^POST \/services\/([^/]+)\/(stop|restart)$/.exec(route);
        if (action?.[1] !== undefined) {
          const effect =
            action[2] === "stop" ? api.stopService(action[1]) : api.restartService(action[1]);
          return respond(200, await Effect.runPromise(effect));
        }
        return respond(404, { message: `unknown route: ${route}` });
      } catch (error) {
        return respond(422, {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };

    const start = Effect.fn("SessionSocketHost.start")(function* (
      sessionId: SessionId,
      api: SessionSocketApi,
    ) {
      yield* Effect.sync(() => stopSync(sessionId)); // idempotent re-bind
      const dir = path.join(runRoot(), sessionId);
      const socketPath = path.join(dir, "mend.sock");
      yield* Effect.promise(async () => {
        fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
        fs.writeFileSync(path.join(dir, "bin", "mend"), HELPER_SCRIPT, { mode: 0o755 });
        const server = http.createServer((request, response) => {
          void handle(api, request, response);
        });
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(socketPath, () => {
            server.removeListener("error", reject);
            resolve();
          });
        });
        // The workspace user must reach the socket through the bind mount.
        fs.chmodSync(socketPath, 0o766);
        active.set(sessionId, { server });
      });
      return dir;
    });

    const stop = Effect.fn("SessionSocketHost.stop")(function* (sessionId: SessionId) {
      yield* Effect.sync(() => stopSync(sessionId));
    });

    return { start, stop };
  }),
);

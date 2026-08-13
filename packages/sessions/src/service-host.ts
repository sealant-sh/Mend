import { once } from "node:events";
import * as net from "node:net";

import { SessionProcessesRepo } from "@mend/db";
import type { SealantWorkspaceId, SessionProcessId } from "@mend/domain";
import { SealantClient } from "@mend/sealant";
import type { WorkspaceForward } from "@sealant/sdk";
import { Effect, Layer, Option, Schema } from "effect";
import * as Context from "effect/Context";

/**
 * The host side of a Service (docs/SESSION-SERVICES.md): one ordinary TCP
 * listener per Service on the machine's private interfaces, and per accepted
 * connection one `workspace.forward(port)` byte pipe into the workspace —
 * accept, dial, pump, nothing protocol-aware anywhere.
 *
 * Interfaces and port range are operator policy, not platform facts:
 *   MEND_SERVICE_HOSTS      comma-separated bind addresses (default 127.0.0.1)
 *   MEND_SERVICE_PORT_MIN/) MAX  allocation range (default 43100..43999)
 *
 * Observed state is a side effect of traffic plus a slow probe: a connection
 * that dials through flips the row reachable, a refused dial flips it
 * unreachable, and a 20s probe keeps an idle Service's state honest. The
 * supervisor also notices its row exiting (service stopped, workspace
 * reaped) and closes the listener — the host never decides lifecycle, it
 * follows the record.
 */

export class ServiceBindError extends Schema.TaggedErrorClass<ServiceBindError>()(
  "ServiceBindError",
  {
    message: Schema.String,
  },
) {}

export interface ServiceStartInput {
  readonly processId: SessionProcessId;
  readonly workspaceId: SealantWorkspaceId;
  readonly workspacePort: number;
  /** Reconciliation passes the recorded port so restarts keep URLs stable. */
  readonly preferredHostPort?: number;
}

export class ServiceHost extends Context.Service<
  ServiceHost,
  {
    /** Bind the listener(s) and start pumping; resolves with the bound host port. */
    readonly start: (input: ServiceStartInput) => Effect.Effect<number, ServiceBindError>;
    /** Close the listener(s) and drop live pumps. Idempotent. */
    readonly stop: (processId: SessionProcessId) => Effect.Effect<void>;
    /** One dial through the forward: does anything answer on the workspace port? */
    readonly probe: (
      workspaceId: SealantWorkspaceId,
      workspacePort: number,
    ) => Effect.Effect<boolean>;
  }
>()("@mend/sessions/ServiceHost") {}

const bindHosts = (): ReadonlyArray<string> =>
  (process.env["MEND_SERVICE_HOSTS"] ?? "127.0.0.1")
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host !== "");

const portRange = (): { readonly min: number; readonly max: number } => {
  const min = Number(process.env["MEND_SERVICE_PORT_MIN"] ?? "43100");
  const max = Number(process.env["MEND_SERVICE_PORT_MAX"] ?? "43999");
  return Number.isInteger(min) && Number.isInteger(max) && min > 0 && max >= min
    ? { min, max }
    : { min: 43100, max: 43999 };
};

const listenOnce = (host: string, port: number): Promise<net.Server> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });

/** Copy bytes both ways between an accepted socket and a forward pipe until either side ends. */
const pump = (socket: net.Socket, forward: WorkspaceForward): void => {
  socket.setNoDelay(true);
  socket.on("data", (bytes) => forward.send(bytes));
  // Client half-close: no more outbound; the response keeps flowing.
  socket.on("end", () => forward.eof());
  socket.on("error", () => forward.close());
  socket.on("close", () => forward.close());
  void (async () => {
    try {
      for await (const chunk of forward.output) {
        // Honor the client socket's backpressure — a slow phone must slow
        // the workspace read, not grow this process.
        if (!socket.write(chunk)) {
          await once(socket, "drain");
        }
      }
    } catch {
      // The forward died mid-stream; the socket teardown below is the signal.
    }
    socket.end();
  })();
};

interface ActiveService {
  readonly servers: ReadonlyArray<net.Server>;
  readonly timer: NodeJS.Timeout;
  /** Live pump sockets — a shutdown must sever these or the process never exits. */
  readonly sockets: Set<net.Socket>;
  lastStatus: "reachable" | "unreachable" | null;
}

const PROBE_INTERVAL_MS = 20_000;

export const ServiceHostLive: Layer.Layer<
  ServiceHost,
  never,
  SealantClient | SessionProcessesRepo
> = Layer.effect(
  ServiceHost,
  Effect.gen(function* () {
    const sealant = yield* SealantClient;
    const processes = yield* SessionProcessesRepo;
    const active = new Map<SessionProcessId, ActiveService>();

    // Graceful shutdown: close every listener and sever every pump, or the
    // open handles keep the process alive and `pnpm dev` restarts wedge into
    // a half-dead server (HTTP gone, Service ports still held).
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const processId of Array.from(active.keys())) {
          stopSync(processId);
        }
      }),
    );

    /**
     * "The workspace's port" is one namespace to the user, two to Docker: a
     * native process listens on the container loopback, while an inner
     * `docker compose` publishes on the workspace-scoped dind sidecar
     * (alias `docker`). Dial loopback first — deterministic when both
     * answer — then fall back to the sidecar. A fixed two-element chain,
     * not discovery.
     */
    const dial = (workspaceId: SealantWorkspaceId, workspacePort: number) =>
      Effect.gen(function* () {
        const workspace = yield* sealant.getWorkspace(workspaceId);
        return yield* sealant
          .forward(workspace, workspacePort, "127.0.0.1")
          .pipe(Effect.catch(() => sealant.forward(workspace, workspacePort, "docker")));
      });

    /** Flip the row's observed state, but only on transitions — not per connection. */
    const observe = (
      processId: SessionProcessId,
      status: "reachable" | "unreachable",
    ): Promise<void> => {
      const entry = active.get(processId);
      if (entry === undefined || entry.lastStatus === status) {
        return Promise.resolve();
      }
      entry.lastStatus = status;
      return Effect.runPromise(processes.setStatus(processId, status).pipe(Effect.ignore));
    };

    const stopSync = (processId: SessionProcessId): void => {
      const entry = active.get(processId);
      if (entry === undefined) {
        return;
      }
      active.delete(processId);
      clearInterval(entry.timer);
      for (const server of entry.servers) {
        server.close();
      }
      // server.close() only stops accepting; established pumps must be
      // severed or they hold the event loop (and a graceful shutdown) open.
      for (const socket of entry.sockets) {
        socket.destroy();
      }
      entry.sockets.clear();
    };

    const probe = (workspaceId: SealantWorkspaceId, workspacePort: number) =>
      dial(workspaceId, workspacePort).pipe(
        Effect.flatMap((forward) =>
          Effect.sync(() => {
            forward.close();
            return true;
          }),
        ),
        Effect.catch(() => Effect.succeed(false)),
      );

    const start = Effect.fn("ServiceHost.start")(function* (input: ServiceStartInput) {
      const hosts = bindHosts();
      const { min, max } = portRange();
      const candidates = input.preferredHostPort === undefined ? [] : [input.preferredHostPort];
      for (let port = min; port <= max; port++) {
        if (port !== input.preferredHostPort) {
          candidates.push(port);
        }
      }

      const onConnection = (socket: net.Socket): void => {
        const entry = active.get(input.processId);
        if (entry !== undefined) {
          entry.sockets.add(socket);
          socket.once("close", () => entry.sockets.delete(socket));
        }
        void Effect.runPromise(dial(input.workspaceId, input.workspacePort).pipe(Effect.option))
          .then((forward) => {
            if (Option.isNone(forward)) {
              void observe(input.processId, "unreachable");
              socket.destroy();
              return undefined;
            }
            void observe(input.processId, "reachable");
            pump(socket, forward.value);
            return undefined;
          })
          .catch(() => socket.destroy());
      };

      // All configured interfaces bind the SAME port, so one URL works from
      // every route to the machine; any collision moves to the next port.
      const bindAll = (port: number) =>
        Effect.tryPromise({
          try: async () => {
            const servers: net.Server[] = [];
            try {
              for (const host of hosts) {
                servers.push(await listenOnce(host, port));
              }
              return servers;
            } catch (cause) {
              for (const server of servers) {
                server.close();
              }
              throw cause;
            }
          },
          catch: () => new Error(`port ${port} is taken`),
        }).pipe(Effect.option);

      for (const port of candidates) {
        const bound = yield* bindAll(port);
        if (Option.isNone(bound)) {
          continue;
        }
        const servers = bound.value;
        for (const server of servers) {
          server.on("connection", onConnection);
        }
        // The supervisor: keep an idle Service's state honest, and follow
        // the record — a row that exited (stopped, workspace reaped) closes
        // the listener from here.
        const timer = setInterval(() => {
          void Effect.runPromise(
            Effect.gen(function* () {
              const row = yield* processes.byId(input.processId);
              if (row === null || row.exitedAt !== null) {
                stopSync(input.processId);
                return;
              }
              const reachable = yield* probe(input.workspaceId, input.workspacePort);
              yield* Effect.promise(() =>
                observe(input.processId, reachable ? "reachable" : "unreachable"),
              );
            }).pipe(Effect.ignore),
          );
        }, PROBE_INTERVAL_MS);
        timer.unref();
        active.set(input.processId, { servers, timer, sockets: new Set(), lastStatus: null });
        return port;
      }

      return yield* new ServiceBindError({
        message: `No free host port in ${min}..${max} on ${hosts.join(", ")}.`,
      });
    });

    const stop = Effect.fn("ServiceHost.stop")(function* (processId: SessionProcessId) {
      yield* Effect.sync(() => stopSync(processId));
    });

    return { start, stop, probe };
  }),
);

import * as dgram from "node:dgram";
import { once } from "node:events";
import * as net from "node:net";

import { ServiceForwardsRepo, ServiceObservationsRepo } from "@mend/db";
import type { SealantWorkspaceId, ServiceForwardId, ServiceId } from "@mend/domain";
import type { ServiceObservationSource } from "@mend/domain/workbench";
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
 * UDP Services bind a datagram socket instead. Each source address is one
 * flow: its first datagram dials the workspace (loopback AND the docker
 * sidecar — UDP has no refused connect to drive the TCP fallback chain, so
 * both are dialed and the first target that answers is pinned). One frame on
 * the forward is exactly one datagram, both directions. Reachability is
 * traffic-driven only: a reply is evidence, silence is not — an idle UDP
 * Service simply keeps whatever status it had.
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
  readonly serviceId: ServiceId;
  readonly forwardId: ServiceForwardId;
  readonly workspaceId: SealantWorkspaceId;
  readonly workspacePort: number;
  /** Declared transport; UDP binds a datagram socket and relays flows. */
  readonly protocol: "tcp" | "udp";
  /** Reconciliation passes the recorded port so restarts keep URLs stable. */
  readonly preferredHostPort?: number;
}

export interface ServiceHostBinding {
  readonly hostPort: number;
  readonly boundAddresses: ReadonlyArray<string>;
}

export class ServiceHost extends Context.Service<
  ServiceHost,
  {
    /** Bind the listener(s) and start pumping; resolves with the exact host binding. */
    readonly start: (
      input: ServiceStartInput,
    ) => Effect.Effect<ServiceHostBinding, ServiceBindError>;
    /** Close the listener(s) and drop live pumps. Idempotent. */
    readonly stop: (serviceId: ServiceId) => Effect.Effect<void>;
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

/** One UDP peer's relay: the dialed forwards, pinned to whichever answered. */
interface UdpFlow {
  forwards: WorkspaceForward[];
  pinned: WorkspaceForward | null;
  /** Datagrams that arrived before any dial finished — flushed on attach so a
   * single-shot client (DNS-style) does not lose its first packet. Bounded:
   * UDP's own contract is drop, not queue. */
  pending: Uint8Array[];
  lastSeen: number;
}

/** How many pre-dial datagrams to hold per flow before dropping. */
const UDP_PENDING_MAX = 16;

interface ActiveService {
  readonly servers: ReadonlyArray<net.Server>;
  readonly dgrams: ReadonlyArray<dgram.Socket>;
  readonly flows: Map<string, UdpFlow>;
  readonly timer: NodeJS.Timeout;
  /** Live pump sockets — a shutdown must sever these or the process never exits. */
  readonly sockets: Set<net.Socket>;
  lastStatus: "reachable" | "unreachable" | null;
}

const PROBE_INTERVAL_MS = 20_000;

/** A UDP flow with no datagram either way for this long is over. */
const UDP_FLOW_IDLE_MS = 120_000;

export const ServiceHostLive: Layer.Layer<
  ServiceHost,
  never,
  SealantClient | ServiceForwardsRepo | ServiceObservationsRepo
> = Layer.effect(
  ServiceHost,
  Effect.gen(function* () {
    const sealant = yield* SealantClient;
    const forwards = yield* ServiceForwardsRepo;
    const observations = yield* ServiceObservationsRepo;
    const active = new Map<ServiceId, ActiveService>();

    // Graceful shutdown: close every listener and sever every pump, or the
    // open handles keep the process alive and `pnpm dev` restarts wedge into
    // a half-dead server (HTTP gone, Service ports still held).
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const serviceId of Array.from(active.keys())) {
          stopSync(serviceId);
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

    /** Persist target-state episodes, but only on transitions — not per connection. */
    const observe = (
      input: ServiceStartInput,
      status: "reachable" | "unreachable",
      source: ServiceObservationSource,
    ): Promise<void> => {
      const entry = active.get(input.serviceId);
      if (entry === undefined || entry.lastStatus === status) {
        return Promise.resolve();
      }
      entry.lastStatus = status;
      return Effect.runPromise(
        observations
          .record({
            serviceId: input.serviceId,
            forwardId: input.forwardId,
            state: status,
            source,
          })
          .pipe(Effect.ignore),
      );
    };

    const stopSync = (serviceId: ServiceId): void => {
      const entry = active.get(serviceId);
      if (entry === undefined) {
        return;
      }
      active.delete(serviceId);
      clearInterval(entry.timer);
      for (const server of entry.servers) {
        server.close();
      }
      for (const socket of entry.dgrams) {
        socket.close();
      }
      for (const flow of entry.flows.values()) {
        for (const forward of flow.forwards) {
          forward.close();
        }
      }
      entry.flows.clear();
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
      if (input.protocol === "udp") {
        return yield* startUdp(input);
      }
      const hosts = bindHosts();
      const { min, max } = portRange();
      const candidates = input.preferredHostPort === undefined ? [] : [input.preferredHostPort];
      for (let port = min; port <= max; port++) {
        if (port !== input.preferredHostPort) {
          candidates.push(port);
        }
      }

      const onConnection = (socket: net.Socket): void => {
        const entry = active.get(input.serviceId);
        if (entry !== undefined) {
          entry.sockets.add(socket);
          socket.once("close", () => entry.sockets.delete(socket));
        }
        void Effect.runPromise(dial(input.workspaceId, input.workspacePort).pipe(Effect.option))
          .then((forward) => {
            if (Option.isNone(forward)) {
              void observe(input, "unreachable", "connection");
              socket.destroy();
              return undefined;
            }
            void observe(input, "reachable", "connection");
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
              const row = yield* forwards.byId(input.forwardId);
              if (row === null || (row.state !== "binding" && row.state !== "bound")) {
                stopSync(input.serviceId);
                return;
              }
              const reachable = yield* probe(input.workspaceId, input.workspacePort);
              yield* Effect.promise(() =>
                observe(input, reachable ? "reachable" : "unreachable", "probe"),
              );
            }).pipe(Effect.ignore),
          );
        }, PROBE_INTERVAL_MS);
        timer.unref();
        active.set(input.serviceId, {
          servers,
          dgrams: [],
          flows: new Map(),
          timer,
          sockets: new Set(),
          lastStatus: null,
        });
        return { hostPort: port, boundAddresses: hosts };
      }

      return yield* new ServiceBindError({
        message: `No free host port in ${min}..${max} on ${hosts.join(", ")}.`,
      });
    });

    /** Dial one UDP forward to a target; null when the target cannot resolve. */
    const dialUdp = (
      workspaceId: SealantWorkspaceId,
      workspacePort: number,
      host: "127.0.0.1" | "docker",
    ): Promise<WorkspaceForward | null> =>
      Effect.runPromise(
        Effect.gen(function* () {
          const workspace = yield* sealant.getWorkspace(workspaceId);
          return yield* sealant.forward(workspace, workspacePort, host, "udp");
        }).pipe(
          Effect.map((forward): WorkspaceForward | null => forward),
          Effect.catch(() => Effect.succeed(null)),
        ),
      );

    const startUdp = Effect.fn("ServiceHost.startUdp")(function* (input: ServiceStartInput) {
      const hosts = bindHosts();
      const { min, max } = portRange();
      const candidates = input.preferredHostPort === undefined ? [] : [input.preferredHostPort];
      for (let port = min; port <= max; port++) {
        if (port !== input.preferredHostPort) {
          candidates.push(port);
        }
      }

      const openFlow = (socket: dgram.Socket, peer: dgram.RemoteInfo): UdpFlow => {
        const flow: UdpFlow = { forwards: [], pinned: null, pending: [], lastSeen: Date.now() };
        // Both possible targets, concurrently: a native process listens on
        // the workspace loopback, inner compose publishes on the sidecar.
        // The first one that sends anything back is THE target; the other
        // forward closes. Until then outbound datagrams go to both — the
        // wrong target simply drops them, which is UDP's own contract.
        const attach = (forward: WorkspaceForward | null): void => {
          if (forward === null) {
            return;
          }
          const entry = active.get(input.serviceId);
          if (entry === undefined) {
            forward.close();
            return;
          }
          flow.forwards.push(forward);
          for (const datagram of flow.pending.splice(0)) {
            forward.send(datagram);
          }
          void (async () => {
            try {
              for await (const chunk of forward.output) {
                flow.lastSeen = Date.now();
                if (flow.pinned === null) {
                  flow.pinned = forward;
                  for (const other of flow.forwards) {
                    if (other !== forward) {
                      other.close();
                    }
                  }
                  flow.forwards = [forward];
                  // A reply is the only reachability evidence UDP has.
                  void observe(input, "reachable", "udp-reply");
                }
                socket.send(chunk, peer.port, peer.address);
              }
            } catch {
              // Forward died; the flow reaps on idle or service stop.
            }
          })();
        };
        void dialUdp(input.workspaceId, input.workspacePort, "127.0.0.1").then(attach);
        void dialUdp(input.workspaceId, input.workspacePort, "docker").then(attach);
        return flow;
      };

      const bindAllUdp = (port: number) =>
        Effect.tryPromise({
          try: async () => {
            const sockets: dgram.Socket[] = [];
            try {
              for (const host of hosts) {
                const socket = dgram.createSocket(host.includes(":") ? "udp6" : "udp4");
                await new Promise<void>((resolve, reject) => {
                  socket.once("error", reject);
                  socket.bind(port, host, () => {
                    socket.removeListener("error", reject);
                    resolve();
                  });
                });
                sockets.push(socket);
              }
              return sockets;
            } catch (cause) {
              for (const socket of sockets) {
                socket.close();
              }
              throw cause;
            }
          },
          catch: () => new Error(`port ${port} is taken`),
        }).pipe(Effect.option);

      for (const port of candidates) {
        const bound = yield* bindAllUdp(port);
        if (Option.isNone(bound)) {
          continue;
        }
        const sockets = bound.value;
        for (const socket of sockets) {
          socket.on("message", (data, peer) => {
            const entry = active.get(input.serviceId);
            if (entry === undefined) {
              return;
            }
            const key = `${peer.address}:${peer.port}`;
            let flow = entry.flows.get(key);
            if (flow === undefined) {
              flow = openFlow(socket, peer);
              entry.flows.set(key, flow);
            }
            flow.lastSeen = Date.now();
            if (flow.pinned !== null) {
              flow.pinned.send(data);
              return;
            }
            if (flow.forwards.length === 0) {
              // Dials still in flight — hold a bounded handful for the flush.
              if (flow.pending.length < UDP_PENDING_MAX) {
                flow.pending.push(data);
              }
              return;
            }
            for (const forward of flow.forwards) {
              forward.send(data);
            }
          });
        }
        // The supervisor follows the record (row exited → close) and reaps
        // idle flows. No probe: UDP offers no handshake to observe.
        const timer = setInterval(() => {
          void Effect.runPromise(
            Effect.gen(function* () {
              const row = yield* forwards.byId(input.forwardId);
              if (row === null || (row.state !== "binding" && row.state !== "bound")) {
                stopSync(input.serviceId);
                return;
              }
              const entry = active.get(input.serviceId);
              if (entry === undefined) {
                return;
              }
              const now = Date.now();
              for (const [key, flow] of entry.flows) {
                if (now - flow.lastSeen > UDP_FLOW_IDLE_MS) {
                  for (const forward of flow.forwards) {
                    forward.close();
                  }
                  entry.flows.delete(key);
                }
              }
            }).pipe(Effect.ignore),
          );
        }, PROBE_INTERVAL_MS);
        timer.unref();
        active.set(input.serviceId, {
          servers: [],
          dgrams: sockets,
          flows: new Map(),
          timer,
          sockets: new Set(),
          lastStatus: null,
        });
        return { hostPort: port, boundAddresses: hosts };
      }

      return yield* new ServiceBindError({
        message: `No free host port in ${min}..${max} on ${hosts.join(", ")}.`,
      });
    });

    const stop = Effect.fn("ServiceHost.stop")(function* (serviceId: ServiceId) {
      yield* Effect.sync(() => stopSync(serviceId));
    });

    return { start, stop, probe };
  }),
);

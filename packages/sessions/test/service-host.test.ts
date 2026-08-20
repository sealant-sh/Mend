import { once } from "node:events";
import * as net from "node:net";

import { ServiceForwardsRepo, ServiceObservationsRepo } from "@mend/db";
import {
  SealantWorkspaceId,
  ServiceForwardId,
  ServiceId,
  ServiceObservationId,
} from "@mend/domain";
import { ServiceObservation } from "@mend/domain/workbench";
import { SealantClient } from "@mend/sealant";
import { ServiceHost, ServiceHostLive } from "@mend/sessions";
import type { Workspace, WorkspaceForward } from "@sealant/sdk";
import { Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";

/**
 * The host side with real sockets and a fake platform: the forward is an
 * in-memory echo, so bytes written into the listener must come back out —
 * proving accept → dial → pump end to end without a workspace.
 */

process.env["MEND_SERVICE_PORT_MIN"] = "45710";
process.env["MEND_SERVICE_PORT_MAX"] = "45719";

const echoForward = (): WorkspaceForward => {
  const pending: Uint8Array[] = [];
  let wake: (() => void) | undefined;
  let finished = false;
  const finish = () => {
    finished = true;
    wake?.();
  };
  return {
    // Echo: everything sent toward the workspace comes back as output.
    send: (bytes) => {
      pending.push(new Uint8Array(bytes));
      wake?.();
    },
    eof: finish,
    output: {
      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<Uint8Array>> => {
          for (;;) {
            const chunk = pending.shift();
            if (chunk !== undefined) return { done: false, value: chunk };
            if (finished) return { done: true, value: undefined };
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            wake = undefined;
          }
        },
      }),
    },
    closed: new Promise<"end" | "closed">(() => {}),
    close: finish,
  };
};

const fakeWorkspace: Workspace = {
  id: "workspace-1",
  name: "fake",
  status: async () => "ready",
  ready: async function () {
    return this;
  },
  harness: {
    run: async () => new Promise(() => {}),
    start: async () => new Promise(() => {}),
    session: async () => new Promise(() => {}),
  },
  exec: async () => new Promise(() => {}),
  sessions: {
    open: async () => new Promise(() => {}),
    get: async () => new Promise(() => {}),
    list: async () => [],
  },
  events: async function* () {},
  forward: async () => echoForward(),
  stop: async () => undefined,
  restart: async function () {
    return this;
  },
  expire: async () => undefined,
};

const sealantFakeLayer = Layer.succeed(SealantClient, {
  createWorkspace: () => Effect.die("not in test"),
  getWorkspace: () => Effect.succeed(fakeWorkspace),
  getRun: () => Effect.die("not in test"),
  runHarness: () => Effect.die("not in test"),
  startHarness: () => Effect.die("not in test"),
  startHarnessInWorkspace: () => Effect.die("not in test"),
  waitRun: () => Effect.die("not in test"),
  openSession: () => Effect.die("not in test"),
  forward: (workspace, port) => Effect.promise(() => workspace.forward(port)),
  stopWorkspace: () => Effect.die("not in test"),
  expireWorkspace: () => Effect.die("not in test"),
  getSession: () => Effect.die("not in test"),
  exec: () => Effect.die("not in test"),
  diffCommits: () => Effect.die("not in test"),
  inferenceRespond: () => Effect.die("not in test"),
  recordStream: () => Stream.fromEffect(Effect.die("not in test")),
  recordTimeline: () => Stream.fromEffect(Effect.die("not in test")),
  recordCommands: () => Effect.die("not in test"),
  recordScrollback: () => Effect.die("not in test"),
  runChanges: () => Effect.die("not in test"),
  connectionCheck: () => Effect.die("not in test"),
  resolveWorkspacePackage: () => Effect.die("not in test"),
});

const forwardsStubLayer = Layer.succeed(ServiceForwardsRepo, {
  create: () => Effect.die("not in test"),
  byId: () => Effect.succeed(null),
  listForService: () => Effect.succeed([]),
  listOpen: () => Effect.succeed([]),
  markBound: () => Effect.void,
  markFailed: () => Effect.void,
  markClosed: () => Effect.void,
});

const observationsStubLayer = Layer.succeed(ServiceObservationsRepo, {
  record: (input) =>
    Effect.succeed(
      new ServiceObservation({
        id: ServiceObservationId.make(crypto.randomUUID()),
        ...input,
        error: input.error ?? null,
        firstObservedAt: new Date(),
        lastObservedAt: new Date(),
      }),
    ),
  latestForService: () => Effect.succeed(null),
  listForService: () => Effect.succeed([]),
});

const TestLayer = ServiceHostLive.pipe(
  Layer.provide(sealantFakeLayer),
  Layer.provide(Layer.mergeAll(forwardsStubLayer, observationsStubLayer)),
);

const SERVICE_ID = ServiceId.make("svc-1");
const FORWARD_ID = ServiceForwardId.make("forward-1");
const WORKSPACE_ID = SealantWorkspaceId.make("workspace-1");

describe("ServiceHost", () => {
  it("accepts, dials a forward, and pumps bytes both ways", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const host = yield* ServiceHost;
        const binding = yield* host.start({
          serviceId: SERVICE_ID,
          forwardId: FORWARD_ID,
          workspaceId: WORKSPACE_ID,
          workspacePort: 3000,
          protocol: "tcp",
        });

        const echoed = yield* Effect.promise(async () => {
          const socket = net.connect(binding.hostPort, "127.0.0.1");
          await once(socket, "connect");
          socket.write("ping through the pump");
          socket.end(); // half-close: the echo must still drain back
          const chunks: Buffer[] = [];
          socket.on("data", (chunk) => chunks.push(chunk));
          await once(socket, "close");
          return Buffer.concat(chunks).toString();
        });
        expect(echoed).toBe("ping through the pump");

        yield* host.stop(SERVICE_ID);
        // The listener is gone: a fresh connect must be refused.
        const refused = yield* Effect.promise(
          () =>
            new Promise<boolean>((resolve) => {
              const socket = net.connect(binding.hostPort, "127.0.0.1");
              socket.once("error", () => resolve(true));
              socket.once("connect", () => {
                socket.destroy();
                resolve(false);
              });
            }),
        );
        expect(refused).toBe(true);
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  it("reuses the preferred host port on reconciliation", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const host = yield* ServiceHost;
        const first = yield* host.start({
          serviceId: SERVICE_ID,
          forwardId: FORWARD_ID,
          workspaceId: WORKSPACE_ID,
          workspacePort: 3000,
          protocol: "tcp",
        });
        yield* host.stop(SERVICE_ID);
        const second = yield* host.start({
          serviceId: SERVICE_ID,
          forwardId: FORWARD_ID,
          workspaceId: WORKSPACE_ID,
          workspacePort: 3000,
          protocol: "tcp",
          preferredHostPort: first.hostPort,
        });
        expect(second.hostPort).toBe(first.hostPort);
        yield* host.stop(SERVICE_ID);
      }).pipe(Effect.provide(TestLayer)),
    );
  });
});

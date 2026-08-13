import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { AgentBridge, AgentBridgeLive } from "../src/agent-bridge.ts";
import { MendKeysConfig } from "../src/git-auth.ts";

const withBridge = <A, E>(work: Effect.Effect<A, E, AgentBridge>): Promise<A> => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mend-bridge-"));
  const layer = AgentBridgeLive.pipe(Layer.provide(MendKeysConfig.layerFor(tmp)));
  return Effect.runPromise(
    work.pipe(
      Effect.provide(layer),
      Effect.ensuring(Effect.sync(() => fs.rmSync(tmp, { recursive: true, force: true }))),
      Effect.orDie,
    ),
  );
};

/** A framed agent message: 4-byte BE length + payload. */
const agentMessage = (...bytes: ReadonlyArray<number>): Buffer => {
  const payload = Buffer.from(bytes);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
};

/** Open the bridged socket, write a request, resolve with the response. */
const askAgent = (socketPath: string, request: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const connection = net.connect(socketPath, () => {
      connection.write(request);
    });
    let pending: Buffer = Buffer.alloc(0);
    connection.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      if (pending.length >= 4 && pending.length >= 4 + pending.readUInt32BE(0)) {
        connection.end();
        resolve(pending);
      }
    });
    connection.on("error", reject);
  });

describe("AgentBridge", () => {
  it("relays framed requests to the share client and answers verbatim", async () => {
    await withBridge(
      Effect.gen(function* () {
        const bridge = yield* AgentBridge;
        expect((yield* bridge.status()).connected).toBe(false);

        const seenContexts: string[] = [];
        // A fake share client that behaves like an agent: answers every
        // request with a canned "identities" response, echoing the id.
        const handleRef: { current: ((frame: string) => void) | null } = { current: null };
        const handle = yield* bridge.attach({
          name: "test-laptop",
          send: (frame) => {
            const parsed = JSON.parse(frame) as {
              id: number;
              context: string;
              payload: string;
            };
            seenContexts.push(parsed.context);
            const response = agentMessage(12, 0, 0, 0, 0); // SSH_AGENT_IDENTITIES_ANSWER, 0 keys
            handleRef.current?.(
              JSON.stringify({ t: "res", id: parsed.id, payload: response.toString("base64") }),
            );
          },
        });
        handleRef.current = handle.feed;

        const bridgeStatus = yield* bridge.status();
        expect(bridgeStatus.connected).toBe(true);
        expect(bridgeStatus.clientName).toBe("test-laptop");

        // An op in flight names itself; the request carries the attribution.
        const end = yield* bridge.begin("adopt shimtest → ssh://localhost/repo");
        const answer = yield* Effect.promise(
          () => askAgent(bridge.socketPath(), agentMessage(11)), // SSH_AGENTC_REQUEST_IDENTITIES
        );
        end();
        expect([...answer.subarray(4)]).toEqual([12, 0, 0, 0, 0]);
        expect(seenContexts).toEqual(["adopt shimtest → ssh://localhost/repo"]);

        // Detach tears the socket down; presence reads false again.
        handle.detach();
        expect((yield* bridge.status()).connected).toBe(false);
        expect(fs.existsSync(bridge.socketPath())).toBe(false);
      }),
    );
  });

  it("answers SSH_AGENT_FAILURE when the client errs a request", async () => {
    await withBridge(
      Effect.gen(function* () {
        const bridge = yield* AgentBridge;
        const handleRef: { current: ((frame: string) => void) | null } = { current: null };
        const handle = yield* bridge.attach({
          name: "flaky-laptop",
          send: (frame) => {
            const parsed = JSON.parse(frame) as { id: number };
            handleRef.current?.(
              JSON.stringify({ t: "err", id: parsed.id, message: "agent timeout" }),
            );
          },
        });
        handleRef.current = handle.feed;

        const answer = yield* Effect.promise(() =>
          askAgent(bridge.socketPath(), agentMessage(13, 1, 2, 3)),
        );
        // [len=1][SSH_AGENT_FAILURE]
        expect([...answer]).toEqual([0, 0, 0, 1, 5]);
        handle.detach();
      }),
    );
  });

  it("a replaced share's late detach does not kill its successor", async () => {
    await withBridge(
      Effect.gen(function* () {
        const bridge = yield* AgentBridge;
        const first = yield* bridge.attach({ name: "first", send: () => {} });
        const second = yield* bridge.attach({ name: "second", send: () => {} });
        first.detach(); // the ghost closes late
        const bridgeStatus = yield* bridge.status();
        expect(bridgeStatus.connected).toBe(true);
        expect(bridgeStatus.clientName).toBe("second");
        second.detach();
        expect((yield* bridge.status()).connected).toBe(false);
      }),
    );
  });
});

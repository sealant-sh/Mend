import { describe, expect, it } from "@effect/vitest";
import type { AgentEvent } from "@mend/domain/workbench";
import { Effect, Fiber, Option, Queue, Stream } from "effect";

import {
  AgentProtocolError,
  ClaudeAdapter,
  CodexAdapter,
  createNdjsonDecoder,
  type AgentTransport,
} from "../src/index.ts";

type JsonObject = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const line = (value: unknown): Uint8Array => new TextEncoder().encode(`${JSON.stringify(value)}\n`);

const parseLine = (bytes: Uint8Array): JsonObject => {
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!isObject(value)) throw new Error("expected object line");
  return value;
};

const makeTransport = Effect.fn("test.makeTransport")(function* (
  onSend: (message: JsonObject, push: (value: unknown) => void) => void,
  onAcknowledge?: () => void,
) {
  const output = yield* Queue.unbounded<Uint8Array, AgentProtocolError>();
  const sent: JsonObject[] = [];
  const push = (value: unknown): void => {
    Queue.offerUnsafe(output, line(value));
  };
  const transport: AgentTransport = {
    send: (bytes) =>
      Effect.sync(() => {
        const message = parseLine(bytes);
        sent.push(message);
        onSend(message, push);
      }),
    output: Stream.fromQueue(output),
    ...(onAcknowledge === undefined ? {} : { acknowledgeOutput: () => Effect.sync(onAcknowledge) }),
    close: () => Queue.shutdown(output),
  };
  return { transport, sent, push, end: Queue.shutdown(output) };
});

const codexTransport = makeTransport((message, push) => {
  const id = message["id"];
  const method = message["method"];
  if (typeof id !== "number") return;
  if (method === "initialize") push({ id, result: {} });
  if (method === "thread/start" || method === "thread/resume") {
    push({ id, result: { thread: { id: "thread-1" } } });
  }
  if (method === "turn/start") push({ id, result: { turn: { id: "turn-1" } } });
  if (method === "turn/interrupt") push({ id, result: {} });
});

const firstEvent = <T extends AgentEvent["_tag"]>(events: Stream.Stream<AgentEvent>, tag: T) =>
  events.pipe(
    Stream.filter(
      (event): event is Extract<AgentEvent, { readonly _tag: T }> => event._tag === tag,
    ),
    Stream.runHead,
  );

describe("NDJSON framing", () => {
  it("preserves split JSON lines and split UTF-8 code points", () => {
    const decoder = createNdjsonDecoder();
    const bytes = new TextEncoder().encode('{"text":"héllo"}\n{"n":2}\n');
    const split = bytes.indexOf(0xc3) + 1;
    expect(decoder.push(bytes.slice(0, split))).toEqual([]);
    expect(decoder.atLineBoundary()).toBe(false);
    expect(decoder.push(bytes.slice(split, bytes.length - 2))).toEqual(['{"text":"héllo"}']);
    expect(decoder.atLineBoundary()).toBe(false);
    expect(decoder.push(bytes.slice(bytes.length - 2))).toEqual(['{"n":2}']);
    expect(decoder.atLineBoundary()).toBe(true);
    expect(decoder.finish()).toEqual([]);
  });
});

describe("CodexAdapter", () => {
  it.effect("fails startup when the pipe dies during initialize", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const transport: AgentTransport = {
          send: () => Effect.void,
          output: Stream.empty,
          close: () => Effect.void,
        };
        const error = yield* CodexAdapter.start(transport, {
          cwd: "/workspace/repo",
          permissionMode: "bypass",
        }).pipe(Effect.flip);
        expect(error).toBeInstanceOf(AgentProtocolError);
        expect(error.message).toContain("output ended");
      }),
    ),
  );

  it.effect("initializes, starts a thread, and starts a turn", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = yield* codexTransport;
        const session = yield* CodexAdapter.start(fake.transport, {
          cwd: "/workspace/repo",
          permissionMode: "ask",
          model: "gpt-test",
          effort: "high",
        });
        const providerTurnId = yield* session.sendTurn("inspect replay");
        expect(providerTurnId).toBe("turn-1");
        expect(fake.sent.map((message) => message["method"])).toEqual([
          "initialize",
          "initialized",
          "thread/start",
          "turn/start",
        ]);
        expect(fake.sent[2]?.["params"]).toEqual({
          cwd: "/workspace/repo",
          approvalPolicy: "on-request",
          sandbox: "workspace-write",
        });
        expect(fake.sent[3]?.["params"]).toEqual({
          threadId: "thread-1",
          input: [{ type: "text", text: "inspect replay" }],
          model: "gpt-test",
          effort: "high",
        });
      }),
    ),
  );

  it.effect("holds an approval response until a person answers", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = yield* codexTransport;
        const session = yield* CodexAdapter.start(fake.transport, {
          cwd: "/workspace/repo",
          permissionMode: "ask",
        });
        yield* session.sendTurn("run it");
        const openedFiber = yield* firstEvent(session.events, "request.opened").pipe(
          Effect.forkChild,
        );
        fake.push({
          id: 42,
          method: "item/commandExecution/requestApproval",
          params: { turnId: "turn-1", itemId: "item-1", command: ["pnpm", "test"] },
        });
        const opened = yield* Fiber.join(openedFiber);
        expect(Option.getOrThrow(opened).request.providerRequestId).toBe("n:42");
        expect(fake.sent.some((message) => message["id"] === 42)).toBe(false);

        yield* session.respond("n:42", "accept-for-session");
        expect(fake.sent.find((message) => message["id"] === 42)).toEqual({
          id: 42,
          result: { decision: "acceptForSession" },
        });
      }),
    ),
  );

  it.effect("maps structured user input answers to Codex's native answer objects", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = yield* codexTransport;
        const session = yield* CodexAdapter.start(fake.transport, {
          cwd: "/workspace/repo",
          permissionMode: "ask",
        });
        yield* session.sendTurn("ask me");
        const openedFiber = yield* firstEvent(session.events, "request.opened").pipe(
          Effect.forkChild,
        );
        fake.push({
          id: "input-1",
          method: "item/tool/requestUserInput",
          params: {
            turnId: "turn-1",
            itemId: "item-1",
            questions: [
              {
                id: "scope",
                header: "Scope",
                question: "Which files?",
                options: [{ label: "All", description: "Every changed file" }],
              },
            ],
          },
        });
        yield* Fiber.join(openedFiber);
        yield* session.respondInput("s:input-1", { scope: ["All"] });
        expect(fake.sent.find((message) => message["id"] === "input-1")).toEqual({
          id: "input-1",
          result: { answers: { scope: { answers: ["All"] } } },
        });
      }),
    ),
  );

  it.effect("projects complete lines before acknowledging their output cursor", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const order: string[] = [];
        const fake = yield* makeTransport(
          (message, push) => {
            const id = message["id"];
            const method = message["method"];
            if (typeof id !== "number") return;
            if (method === "initialize") push({ id, result: {} });
            if (method === "thread/start") {
              push({ id, result: { thread: { id: "thread-1" } } });
            }
            if (method === "turn/start") push({ id, result: { turn: { id: "turn-1" } } });
          },
          () => order.push("ack"),
        );
        const session = yield* CodexAdapter.start(fake.transport, {
          cwd: "/workspace/repo",
          permissionMode: "bypass",
          onEvent: (event) =>
            Effect.sync(() => {
              if (event._tag === "item.updated") order.push("event");
            }),
        });
        yield* session.sendTurn("inspect");
        yield* Effect.yieldNow;
        order.length = 0;
        const itemFiber = yield* firstEvent(session.events, "item.updated").pipe(Effect.forkChild);
        fake.push({
          method: "item/started",
          params: {
            turnId: "turn-1",
            item: { id: "item-1", type: "agentMessage", text: "hello" },
          },
        });
        yield* Fiber.join(itemFiber);
        yield* Effect.yieldNow;
        expect(order).toEqual(["event", "ack"]);
      }),
    ),
  );

  it.effect("turns malformed provider lines into warnings", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = yield* codexTransport;
        const session = yield* CodexAdapter.start(fake.transport, {
          cwd: "/workspace/repo",
          permissionMode: "bypass",
        });
        const warningFiber = yield* firstEvent(session.events, "runtime.warning").pipe(
          Effect.forkChild,
        );
        // A valid JSON scalar is still malformed for the object-only provider protocol.
        fake.push("not json");
        const warning = yield* Fiber.join(warningFiber);
        expect(Option.getOrThrow(warning).message).toContain("non-object");
      }),
    ),
  );
});

describe("ClaudeAdapter", () => {
  it.effect("sends user turns and answers permission control requests", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = yield* makeTransport(() => undefined);
        const session = yield* ClaudeAdapter.start(fake.transport, {
          cwd: "/workspace/repo",
          providerSessionId: "11111111-1111-4111-8111-111111111111",
          permissionMode: "ask",
        });
        const turnId = yield* session.sendTurn("edit the file");
        const openedFiber = yield* firstEvent(session.events, "request.opened").pipe(
          Effect.forkChild,
        );
        fake.push({
          type: "control_request",
          request_id: "permission-1",
          request: {
            subtype: "can_use_tool",
            tool_name: "Edit",
            input: { file_path: "/workspace/repo/a.ts" },
          },
        });
        const opened = yield* Fiber.join(openedFiber);
        expect(Option.getOrThrow(opened).request.providerTurnId).toBe(turnId);
        yield* session.respond("permission-1", "accept-for-session");
        expect(fake.sent.at(-1)).toEqual({
          type: "control_response",
          response: {
            subtype: "success",
            request_id: "permission-1",
            response: {
              behavior: "allow",
              updatedInput: { file_path: "/workspace/repo/a.ts" },
              updatedPermissions: [
                {
                  type: "addRules",
                  rules: [{ toolName: "Edit" }],
                  behavior: "allow",
                  destination: "session",
                },
              ],
            },
          },
        });
      }),
    ),
  );
});

describe("regression: reviewer findings", () => {
  it.effect("claude keeps items distinct across assistant messages in one turn", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = yield* makeTransport(() => {});
        const latest = new Map<string, { text: string | null; kind: string }>();
        const session = yield* ClaudeAdapter.start(fake.transport, {
          cwd: "/workspace/repo",
          permissionMode: "bypass",
          providerSessionId: "11111111-2222-4333-8444-555566667777",
          onEvent: (event) =>
            Effect.sync(() => {
              if (event._tag === "item.updated") {
                latest.set(event.item.providerItemId, {
                  text: event.item.text,
                  kind: event.item.kind,
                });
              }
            }),
        });
        const turnId = yield* session.sendTurn("two steps");
        const push = (event: unknown) =>
          fake.push({
            type: "stream_event",
            session_id: "11111111-2222-4333-8444-555566667777",
            event,
          });
        // Assistant message #1: text block at index 0.
        push({ type: "message_start" });
        push({ type: "content_block_start", index: 0, content_block: { type: "text" } });
        push({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "one" } });
        push({ type: "content_block_stop", index: 0 });
        // Assistant message #2 reuses index 0. Its item must not overwrite message #1's.
        push({ type: "message_start" });
        push({ type: "content_block_start", index: 0, content_block: { type: "text" } });
        push({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "two" } });
        // Await the projection of the second message's delta before asserting.
        yield* session.events.pipe(
          Stream.filter((event) => event._tag === "item.updated" && event.item.text === "two"),
          Stream.runHead,
        );
        const texts = [...latest.entries()]
          .filter(([, item]) => item.kind === "assistant-message")
          .map(([id, item]) => ({ id, text: item.text }));
        expect(texts).toHaveLength(2);
        expect(texts.map((item) => item.text).toSorted()).toEqual(["one", "two"]);
        expect(new Set(texts.map((item) => item.id)).size).toBe(2);
        expect(texts.every((item) => item.id.startsWith(`${turnId}:m`))).toBe(true);
      }),
    ),
  );

  it.effect("codex refuses to answer a request it is not holding", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = yield* codexTransport;
        const session = yield* CodexAdapter.start(fake.transport, {
          cwd: "/workspace/repo",
          permissionMode: "ask",
        });
        const error = yield* session.respond("n:99", "accept").pipe(Effect.flip);
        expect(error).toBeInstanceOf(AgentProtocolError);
        // No stray JSON-RPC response left for an id nothing is waiting on.
        expect(fake.sent.some((message) => message["id"] === 99)).toBe(false);
      }),
    ),
  );
});

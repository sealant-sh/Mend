import type {
  AgentApprovalDecision,
  AgentEvent,
  AgentEventItem,
  AgentInputAnswers,
  AgentInputQuestion,
  AgentItemKind,
  AgentTurnUsage,
} from "@mend/domain/workbench";
import { PubSub, Effect, Stream } from "effect";

import type {
  ClaudeControlRequest,
  ClaudeControlResponse,
  ClaudeUserMessage,
} from "./claude-wire.ts";
import { createNdjsonDecoder } from "./ndjson.ts";
import {
  AgentProtocolError,
  type AgentAdapter,
  type AgentSession,
  type AgentStartOptions,
  type AgentTransport,
} from "./types.ts";

type JsonObject = Readonly<Record<string, unknown>>;

interface PendingControl {
  readonly toolName: string;
  readonly input: JsonObject;
  readonly suggestions: ReadonlyArray<unknown>;
  readonly kind: "approval" | "input";
}

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const objectField = (value: unknown, key: string): JsonObject | null => {
  if (!isObject(value)) return null;
  const field = value[key];
  return isObject(field) ? field : null;
};

const stringField = (value: unknown, key: string): string | null => {
  if (!isObject(value)) return null;
  const field = value[key];
  return typeof field === "string" ? field : null;
};

const integerField = (value: unknown, key: string): number | null => {
  if (!isObject(value)) return null;
  const field = value[key];
  return typeof field === "number" && Number.isSafeInteger(field) && field >= 0 ? field : null;
};

const protocolError = (operation: string, message: string, cause: unknown): AgentProtocolError =>
  new AgentProtocolError({ adapter: "claude", operation, message, cause });

const encodeLine = (value: unknown): Uint8Array =>
  new TextEncoder().encode(`${JSON.stringify(value)}\n`);

const toolKind = (name: string): AgentItemKind => {
  if (name === "Bash" || name === "Shell") return "command-execution";
  if (name === "Write" || name === "Edit" || name === "MultiEdit") return "file-change";
  if (name === "WebSearch" || name === "WebFetch") return "web-search";
  if (name === "TodoWrite" || name.startsWith("Task")) return "plan";
  return "tool-call";
};

const questionsFrom = (input: JsonObject): ReadonlyArray<AgentInputQuestion> | null => {
  const questions = input["questions"];
  if (!Array.isArray(questions)) return null;
  return questions.flatMap((question, index): ReadonlyArray<AgentInputQuestion> => {
    if (!isObject(question)) return [];
    const text = stringField(question, "question");
    if (text === null) return [];
    const rawOptions = question["options"];
    const options = Array.isArray(rawOptions)
      ? rawOptions.flatMap(
          (option): ReadonlyArray<{ label: string; description: string | null }> => {
            if (!isObject(option)) return [];
            const label = stringField(option, "label");
            return label === null
              ? []
              : [{ label, description: stringField(option, "description") }];
          },
        )
      : [];
    return [
      {
        id: stringField(question, "id") ?? String(index),
        header: stringField(question, "header"),
        question: text,
        options,
        multiSelect: question["multiSelect"] === true,
      },
    ];
  });
};

const usageFrom = (value: unknown): AgentTurnUsage | null => {
  if (!isObject(value)) return null;
  const inputTokens = integerField(value, "input_tokens");
  const outputTokens = integerField(value, "output_tokens");
  const cachedInputTokens =
    (integerField(value, "cache_read_input_tokens") ?? 0) +
    (integerField(value, "cache_creation_input_tokens") ?? 0);
  if (inputTokens === null && outputTokens === null && cachedInputTokens === 0) return null;
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    totalTokens:
      inputTokens === null && outputTokens === null
        ? null
        : (inputTokens ?? 0) + (outputTokens ?? 0),
    contextWindow: null,
  };
};

const sessionPermissionUpdates = (
  toolName: string,
  suggestions: ReadonlyArray<unknown>,
): ReadonlyArray<JsonObject> => {
  const scoped = suggestions.flatMap(
    (suggestion): ReadonlyArray<JsonObject> =>
      isObject(suggestion) ? [{ ...suggestion, destination: "session" }] : [],
  );
  return scoped.length > 0
    ? scoped
    : [
        {
          type: "addRules",
          rules: [{ toolName }],
          behavior: "allow",
          destination: "session",
        },
      ];
};

const controlResponse = (requestId: string, response: JsonObject): ClaudeControlResponse => ({
  type: "control_response",
  response: { subtype: "success", request_id: requestId, response },
});

/** Claude Code private stream-json adapter pinned by CLAUDE_CODE_PROTOCOL_VERSION. */
export const ClaudeAdapter: AgentAdapter = {
  start: (transport: AgentTransport, options: AgentStartOptions) =>
    Effect.gen(function* () {
      const events = yield* PubSub.unbounded<AgentEvent>({ replay: 32 });
      const decoder = createNdjsonDecoder();
      const pending = new Map<string, PendingControl>();
      const items = new Map<string, AgentEventItem>();
      const sessionId = options.providerSessionId ?? crypto.randomUUID();
      let currentTurnId: string | null = null;
      let closed = false;

      const publish = (event: AgentEvent): Effect.Effect<void> =>
        (options.onEvent === undefined ? Effect.void : options.onEvent(event)).pipe(
          Effect.andThen(PubSub.publish(events, event)),
          Effect.asVoid,
        );
      const send = (value: unknown): Effect.Effect<void, AgentProtocolError> =>
        transport.send(encodeLine(value));
      const updateItem = (item: AgentEventItem): Effect.Effect<void> => {
        items.set(item.providerItemId, item);
        return publish({ _tag: "item.updated", item });
      };

      const completeContentBlocks = (message: JsonObject): Effect.Effect<void> => {
        if (currentTurnId === null) return Effect.void;
        const content = objectField(message, "message")?.["content"];
        if (!Array.isArray(content)) return Effect.void;
        return Effect.forEach(
          content,
          (block, index) => {
            if (!isObject(block)) return Effect.void;
            const type = stringField(block, "type");
            const id = stringField(block, "id") ?? `${currentTurnId}:block:${index}`;
            const kind: AgentItemKind =
              type === "text"
                ? "assistant-message"
                : type === "thinking"
                  ? "reasoning"
                  : type === "tool_use"
                    ? toolKind(stringField(block, "name") ?? "tool")
                    : "other";
            return updateItem({
              providerItemId: id,
              providerTurnId: currentTurnId ?? "",
              kind,
              status: "completed",
              title: type === "tool_use" ? stringField(block, "name") : null,
              text: stringField(block, "text") ?? stringField(block, "thinking") ?? null,
              data: block,
            });
          },
          { discard: true },
        );
      };

      const handleStreamEvent = (message: JsonObject): Effect.Effect<void> => {
        if (currentTurnId === null) return Effect.void;
        const event = objectField(message, "event");
        if (event === null) return Effect.void;
        const eventType = stringField(event, "type");
        const index = integerField(event, "index") ?? 0;
        const fallbackId = `${currentTurnId}:block:${index}`;
        if (eventType === "content_block_start") {
          const block = objectField(event, "content_block");
          if (block === null) return Effect.void;
          const type = stringField(block, "type");
          const providerItemId = stringField(block, "id") ?? fallbackId;
          const kind: AgentItemKind =
            type === "text"
              ? "assistant-message"
              : type === "thinking"
                ? "reasoning"
                : type === "tool_use"
                  ? toolKind(stringField(block, "name") ?? "tool")
                  : "other";
          return updateItem({
            providerItemId,
            providerTurnId: currentTurnId,
            kind,
            status: "in-progress",
            title: type === "tool_use" ? stringField(block, "name") : null,
            text: stringField(block, "text") ?? stringField(block, "thinking"),
            data: block,
          });
        }
        if (eventType === "content_block_delta") {
          const deltaObject = objectField(event, "delta");
          const delta =
            stringField(deltaObject, "text") ?? stringField(deltaObject, "thinking") ?? "";
          if (delta === "") return Effect.void;
          const previous = items.get(fallbackId);
          const item: AgentEventItem = previous ?? {
            providerItemId: fallbackId,
            providerTurnId: currentTurnId,
            kind:
              stringField(deltaObject, "type") === "thinking_delta"
                ? "reasoning"
                : "assistant-message",
            status: "in-progress",
            title: null,
            text: null,
            data: null,
          };
          const next = { ...item, text: `${item.text ?? ""}${delta}` };
          return publish({
            _tag: "content.delta",
            providerItemId: item.providerItemId,
            providerTurnId: currentTurnId,
            delta,
          }).pipe(Effect.andThen(updateItem(next)));
        }
        if (eventType === "content_block_stop") {
          const previous = items.get(fallbackId);
          return previous === undefined
            ? Effect.void
            : updateItem({ ...previous, status: "completed" });
        }
        return Effect.void;
      };

      const handleControlRequest = (message: JsonObject): Effect.Effect<void> => {
        const requestId = stringField(message, "request_id");
        const request = objectField(message, "request");
        if (requestId === null || request === null) return Effect.void;
        const subtype = stringField(request, "subtype");
        if (subtype !== "can_use_tool") {
          return send(
            controlResponse(requestId, { behavior: "deny", message: "Unsupported request" }),
          ).pipe(Effect.catch(() => Effect.void));
        }
        const toolName = stringField(request, "tool_name") ?? "tool";
        const input = objectField(request, "input") ?? {};
        const rawSuggestions = request["permission_suggestions"];
        const suggestions = Array.isArray(rawSuggestions) ? rawSuggestions : [];
        const kind = toolName === "AskUserQuestion" ? "input" : "approval";
        pending.set(requestId, { toolName, input, suggestions, kind });
        if (currentTurnId === null) {
          pending.delete(requestId);
          return send(
            controlResponse(requestId, { behavior: "deny", message: "No active turn" }),
          ).pipe(Effect.catch(() => Effect.void));
        }
        return publish({
          _tag: "request.opened",
          request: {
            providerRequestId: requestId,
            providerTurnId: currentTurnId,
            providerItemId: stringField(input, "tool_use_id"),
            kind: kind === "input" ? "user-input" : "tool-permission",
            title: toolName,
            detail: { toolName, input, suggestions },
            questions: kind === "input" ? questionsFrom(input) : null,
          },
        });
      };

      const handleResult = (message: JsonObject): Effect.Effect<void> => {
        if (currentTurnId === null) return Effect.void;
        const providerTurnId = currentTurnId;
        const subtype = stringField(message, "subtype");
        const terminalReason = stringField(message, "terminal_reason");
        const errors = message["errors"];
        const error = Array.isArray(errors)
          ? (errors.find((candidate): candidate is string => typeof candidate === "string") ?? null)
          : null;
        const status =
          terminalReason === "aborted_tools" || terminalReason === "aborted_streaming"
            ? "interrupted"
            : subtype === "success"
              ? "completed"
              : "failed";
        currentTurnId = null;
        return publish({
          _tag: "turn.completed",
          providerTurnId,
          status,
          usage: usageFrom(message["usage"]),
          error,
        });
      };

      const handleMessage = (value: unknown): Effect.Effect<void> => {
        if (!isObject(value)) {
          return publish({ _tag: "runtime.warning", message: "Claude emitted a non-object line." });
        }
        const type = stringField(value, "type");
        const providerSessionId = stringField(value, "session_id");
        const ready =
          providerSessionId === null
            ? Effect.void
            : publish({ _tag: "session.ready", providerSessionId });
        switch (type) {
          case "system":
            return ready.pipe(
              Effect.andThen(
                publish({
                  _tag: "runtime.warning",
                  message: `Claude system message: ${stringField(value, "subtype") ?? "unknown"}`,
                }),
              ),
            );
          case "stream_event":
            return ready.pipe(Effect.andThen(handleStreamEvent(value)));
          case "assistant":
            return ready.pipe(Effect.andThen(completeContentBlocks(value)));
          case "control_request":
            return ready.pipe(Effect.andThen(handleControlRequest(value)));
          case "result":
            return ready.pipe(Effect.andThen(handleResult(value)));
          default:
            return ready;
        }
      };

      const handleLine = (line: string): Effect.Effect<void> => {
        try {
          const value: unknown = JSON.parse(line);
          return handleMessage(value);
        } catch (cause) {
          const error = protocolError("decode", "Claude emitted malformed NDJSON.", cause);
          return publish({ _tag: "runtime.warning", message: error.message });
        }
      };

      const handleBytes = (bytes: Uint8Array): Effect.Effect<void, AgentProtocolError> =>
        Effect.forEach(decoder.push(bytes), handleLine, { discard: true }).pipe(
          Effect.andThen(
            decoder.atLineBoundary() && transport.acknowledgeOutput !== undefined
              ? transport.acknowledgeOutput()
              : Effect.void,
          ),
        );

      yield* transport.output.pipe(
        Stream.runForEach(handleBytes),
        Effect.andThen(Effect.forEach(decoder.finish(), handleLine, { discard: true })),
        Effect.tap(() =>
          currentTurnId === null
            ? Effect.void
            : publish({
                _tag: "turn.completed",
                providerTurnId: currentTurnId,
                status: "failed",
                usage: null,
                error: "Claude process ended during the turn.",
              }),
        ),
        Effect.tap(() =>
          publish({ _tag: "runtime.error", message: "Claude process output ended." }),
        ),
        Effect.catch((error) =>
          publish({ _tag: "runtime.error", message: `Claude transport ended: ${error.message}` }),
        ),
        Effect.forkScoped,
      );

      yield* publish({ _tag: "session.ready", providerSessionId: sessionId });

      const sendTurn = Effect.fn("ClaudeAdapter.sendTurn")(function* (input: string) {
        if (currentTurnId !== null) {
          return yield* protocolError(
            "sendTurn",
            "Claude already has a turn in progress.",
            currentTurnId,
          );
        }
        const providerTurnId = crypto.randomUUID();
        currentTurnId = providerTurnId;
        const message: ClaudeUserMessage = {
          type: "user",
          session_id: sessionId,
          parent_tool_use_id: null,
          origin: { kind: "human" },
          message: { role: "user", content: [{ type: "text", text: input }] },
        };
        yield* send(message).pipe(Effect.tapError(() => Effect.sync(() => (currentTurnId = null))));
        yield* publish({ _tag: "turn.started", providerTurnId });
        return providerTurnId;
      });

      const interrupt = Effect.fn("ClaudeAdapter.interrupt")(function* () {
        if (currentTurnId === null) return;
        const request: ClaudeControlRequest = {
          type: "control_request",
          request_id: crypto.randomUUID(),
          request: { subtype: "interrupt" },
        };
        yield* send(request);
      });

      const respond = Effect.fn("ClaudeAdapter.respond")(function* (
        providerRequestId: string,
        decision: AgentApprovalDecision,
      ) {
        const request = pending.get(providerRequestId);
        if (request === undefined || request.kind !== "approval") {
          return yield* protocolError(
            "respond",
            `Unknown Claude approval request ${providerRequestId}.`,
            null,
          );
        }
        const response: JsonObject =
          decision === "accept" || decision === "accept-for-session"
            ? {
                behavior: "allow",
                updatedInput: request.input,
                ...(decision === "accept-for-session"
                  ? {
                      updatedPermissions: sessionPermissionUpdates(
                        request.toolName,
                        request.suggestions,
                      ),
                    }
                  : {}),
              }
            : {
                behavior: "deny",
                message: decision === "cancel" ? "Cancelled by user" : "Declined by user",
                interrupt: decision === "cancel",
              };
        yield* send(controlResponse(providerRequestId, response));
        pending.delete(providerRequestId);
      });

      const respondInput = Effect.fn("ClaudeAdapter.respondInput")(function* (
        providerRequestId: string,
        answers: AgentInputAnswers,
      ) {
        const request = pending.get(providerRequestId);
        if (request === undefined || request.kind !== "input") {
          return yield* protocolError(
            "respondInput",
            `Unknown Claude user-input request ${providerRequestId}.`,
            null,
          );
        }
        yield* send(
          controlResponse(providerRequestId, {
            behavior: "allow",
            updatedInput: { ...request.input, answers },
          }),
        );
        pending.delete(providerRequestId);
      });

      const close = Effect.fn("ClaudeAdapter.close")(function* () {
        if (closed) return;
        closed = true;
        for (const providerRequestId of pending.keys()) {
          yield* send(
            controlResponse(providerRequestId, {
              behavior: "deny",
              message: "Mend closed the protocol session.",
              interrupt: true,
            }),
          ).pipe(Effect.ignore);
        }
        pending.clear();
        yield* transport.close();
        yield* PubSub.shutdown(events);
      });

      return {
        sendTurn,
        interrupt,
        respond,
        respondInput,
        events: Stream.fromPubSub(events),
        close,
      } satisfies AgentSession;
    }),
};

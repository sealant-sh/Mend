import {
  AgentProtocolError,
  ClaudeAdapter,
  CodexAdapter,
  type AgentSession,
} from "@mend/agent-protocol";
import {
  AgentConversationRepo,
  type AgentRequestAlreadyResolvedError,
  type AgentRequestNotFoundError,
  SessionProcessesRepo,
  SessionsRepo,
} from "@mend/db";
import type { AgentTurnId, SessionId, SessionProcessId } from "@mend/domain";
import type {
  AgentApprovalDecision,
  AgentEvent,
  AgentInputAnswers,
  AgentRequest,
  AgentTurn,
  SessionProcess,
} from "@mend/domain/workbench";
import { SealantPlatformError } from "@mend/sealant";
import type { InteractiveSession } from "@sealant/sdk";
import { Effect, Layer, Schema, Scope, Stream } from "effect";
import * as Context from "effect/Context";
import * as Semaphore from "effect/Semaphore";

/** A live protocol process or provider request cannot be addressed by this Mend process. */
export class ProtocolHostNotLiveError extends Schema.TaggedErrorClass<ProtocolHostNotLiveError>()(
  "ProtocolHostNotLiveError",
  { processId: Schema.String },
) {}

/** Hooks that return protocol observations to the owning session engine. */
export interface ProtocolHostHooks {
  readonly onRequestChanged: (sessionId: SessionId) => Effect.Effect<void>;
  readonly onTurnCompleted: (turn: AgentTurn) => Effect.Effect<void>;
}

/** Options needed to initialize a protocol adapter after the pipe process starts. */
export interface AttachProtocolProcessInput {
  readonly process: SessionProcess;
  readonly pipe: InteractiveSession;
  readonly cwd: string;
  readonly model?: string | undefined;
  readonly effort?: string | undefined;
  readonly permissionMode: "bypass" | "ask";
  readonly hooks: ProtocolHostHooks;
}

interface ProviderEventPosition {
  readonly outputSequence: bigint;
  readonly eventIndex: number;
}

interface HostedProcess {
  readonly process: SessionProcess;
  readonly adapter: AgentSession;
  readonly pipe: InteractiveSession;
  readonly hooks: ProtocolHostHooks;
  readonly dispatchPermit: Semaphore.Semaphore;
  readonly abort: AbortController;
}

/**
 * Process-local ownership of live protocol adapters. Durable turns, items, requests, and replay
 * identities stay in AgentConversationRepo; this service owns only byte streams and pending calls.
 */
export class ProtocolHost extends Context.Service<
  ProtocolHost,
  {
    readonly attach: (
      input: AttachProtocolProcessInput,
    ) => Effect.Effect<void, SealantPlatformError>;
    readonly submitTurn: (
      sessionId: SessionId,
      input: string,
      author: string | null,
      launchCorrelationId?: string | null,
    ) => Effect.Effect<AgentTurn, ProtocolHostNotLiveError>;
    readonly interruptTurn: (turnId: AgentTurnId) => Effect.Effect<void, ProtocolHostNotLiveError>;
    readonly respondRequest: (
      request: AgentRequest,
      response:
        | { readonly decision: AgentApprovalDecision; readonly answers?: never }
        | { readonly answers: AgentInputAnswers; readonly decision?: never },
      decidedBy: string,
    ) => Effect.Effect<
      AgentRequest,
      ProtocolHostNotLiveError | AgentRequestNotFoundError | AgentRequestAlreadyResolvedError
    >;
    readonly detach: (processId: SessionProcessId) => Effect.Effect<void>;
    readonly has: (processId: SessionProcessId) => Effect.Effect<boolean>;
  }
>()("@mend/sessions/ProtocolHost") {}

const adapterFor = (harness: string | null) =>
  harness === "claude" ? ClaudeAdapter : CodexAdapter;

const toPlatformError = (operation: string, cause: unknown): SealantPlatformError =>
  new SealantPlatformError({
    code: "agent_protocol_failed",
    status: null,
    message: `Agent protocol ${operation} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    cause,
  });

export const ProtocolHostLive: Layer.Layer<
  ProtocolHost,
  never,
  AgentConversationRepo | SessionProcessesRepo | SessionsRepo
> = Layer.effect(
  ProtocolHost,
  Effect.gen(function* () {
    const conversations = yield* AgentConversationRepo;
    const processes = yield* SessionProcessesRepo;
    const sessions = yield* SessionsRepo;
    const scope = yield* Effect.scope;
    const hosted = new Map<SessionProcessId, HostedProcess>();

    const lookupTurn = Effect.fn("ProtocolHost.lookupTurn")(function* (
      sessionId: SessionId,
      providerTurnId: string,
    ) {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const turn = yield* conversations.byProviderTurnId(sessionId, providerTurnId);
        if (turn !== null) return turn;
        yield* Effect.sleep("10 millis");
      }
      return null;
    });

    const dispatchNext = (entry: HostedProcess): Effect.Effect<void> =>
      entry.dispatchPermit.withPermit(
        Effect.gen(function* () {
          const turn = yield* conversations.claimNextTurn(entry.process.id);
          if (turn === null) return;
          const sent = yield* entry.adapter.sendTurn(turn.input).pipe(Effect.result);
          if (sent._tag === "Failure") {
            yield* conversations.failTurn(turn.id, String(sent.failure)).pipe(Effect.orDie);
            const failed = yield* conversations.byTurnId(turn.id);
            if (failed === null) return yield* Effect.die(`Turn ${turn.id} disappeared`);
            yield* entry.hooks.onTurnCompleted(failed);
            return;
          }
          yield* conversations.setProviderTurnId(turn.id, sent.success).pipe(Effect.orDie);
        }),
      );

    const projectEvent = Effect.fn("ProtocolHost.projectEvent")(function* (
      entry: HostedProcess,
      event: AgentEvent,
      position: ProviderEventPosition,
    ) {
      switch (event._tag) {
        case "session.ready":
          if (event.providerSessionId !== null) {
            yield* processes.setProviderSessionId(entry.process.id, event.providerSessionId);
            yield* sessions.setProviderSessionId(entry.process.sessionId, event.providerSessionId);
          }
          return;
        case "turn.started":
          yield* conversations.bindRunningProviderTurn(
            entry.process.sessionId,
            entry.process.id,
            event.providerTurnId,
          );
          return;
        case "turn.completed": {
          yield* conversations.bindRunningProviderTurn(
            entry.process.sessionId,
            entry.process.id,
            event.providerTurnId,
          );
          const turn = yield* conversations.completeTurn(
            event.providerTurnId,
            entry.process.sessionId,
            event.status,
            event.usage,
            event.error,
          );
          if (turn === null) return;
          yield* conversations.cancelOpenForTurn(turn.id);
          yield* entry.hooks.onRequestChanged(entry.process.sessionId);
          yield* entry.hooks.onTurnCompleted(turn);
          yield* Effect.forkIn(dispatchNext(entry), scope);
          return;
        }
        case "item.updated": {
          const turn = yield* lookupTurn(entry.process.sessionId, event.item.providerTurnId);
          if (turn === null || turn.status !== "running") return;
          yield* conversations.upsertItem({
            ...event.item,
            sessionId: entry.process.sessionId,
            processId: entry.process.id,
            turnId: turn.id,
            providerOutputSeq: position.outputSequence,
            providerEventIndex: position.eventIndex,
          });
          return;
        }
        case "content.delta":
          // Adapters also emit an idempotent whole-item update after every delta. Persisting only
          // that update prevents replay from appending the same fragment twice.
          return;
        case "request.opened": {
          const turn = yield* lookupTurn(entry.process.sessionId, event.request.providerTurnId);
          if (turn === null) return;
          yield* conversations.openRequest({
            ...event.request,
            sessionId: entry.process.sessionId,
            processId: entry.process.id,
            turnId: turn.id,
          });
          yield* entry.hooks.onRequestChanged(entry.process.sessionId);
          return;
        }
        case "request.resolved":
          yield* conversations.resolveProviderRequest(entry.process.id, event.providerRequestId);
          yield* entry.hooks.onRequestChanged(entry.process.sessionId);
          return;
        case "runtime.warning":
          yield* Effect.logWarning(event.message).pipe(
            Effect.annotateLogs({ processId: entry.process.id, harness: entry.process.harness }),
          );
          return;
        case "runtime.error":
          hosted.delete(entry.process.id);
          yield* conversations.cancelOpenForProcess(entry.process.id);
          yield* entry.hooks.onRequestChanged(entry.process.sessionId);
          yield* Effect.tryPromise({
            try: () => entry.pipe.close(),
            catch: () => new Error("protocol pipe close failed"),
          }).pipe(Effect.ignore);
          yield* Effect.logError(event.message).pipe(
            Effect.annotateLogs({ processId: entry.process.id, harness: entry.process.harness }),
          );
      }
    });

    const attach = Effect.fn("ProtocolHost.attach")(function* (input: AttachProtocolProcessInput) {
      const cursor = yield* conversations.protocolCursor(input.process.id);
      const abort = new AbortController();
      // Advance only after the adapter durably projects a newline-complete provider frame.
      let pendingNextSequence = cursor.nextSequence;
      let currentOutputSequence = cursor.nextSequence;
      let currentEventIndex = 0;
      const output = Stream.fromAsyncIterable(
        input.pipe.output({ from: cursor.nextSequence, signal: abort.signal }),
        (cause) => toPlatformError("output", cause),
      ).pipe(
        Stream.map((chunk) => {
          currentOutputSequence = chunk.sequence;
          currentEventIndex = 0;
          pendingNextSequence = chunk.sequence + 1n;
          return chunk.data;
        }),
      );
      const transport = {
        send: (bytes: Uint8Array) =>
          Effect.tryPromise({
            try: () => input.pipe.send(bytes),
            catch: (cause) =>
              new AgentProtocolError({
                adapter: input.process.harness === "claude" ? "claude" : "codex",
                operation: "transport.send",
                message: cause instanceof Error ? cause.message : String(cause),
                cause,
              }),
          }),
        output: output.pipe(
          Stream.mapError(
            (cause) =>
              new AgentProtocolError({
                adapter: input.process.harness === "claude" ? "claude" : "codex",
                operation: "transport.output",
                message: cause.message,
                cause,
              }),
          ),
        ),
        acknowledgeOutput: () =>
          conversations
            .saveProtocolCursor(input.process.id, {
              nextSequence: pendingNextSequence,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new AgentProtocolError({
                    adapter: input.process.harness === "claude" ? "claude" : "codex",
                    operation: "transport.acknowledgeOutput",
                    message: String(cause),
                    cause,
                  }),
              ),
            ),
        close: () => Effect.sync(() => abort.abort()),
      };
      let activeEntry: HostedProcess | null = null;
      const pendingEvents: Array<{
        readonly event: AgentEvent;
        readonly position: ProviderEventPosition;
      }> = [];
      const onEvent = (event: AgentEvent): Effect.Effect<void> => {
        const position = {
          outputSequence: currentOutputSequence,
          eventIndex: currentEventIndex,
        } satisfies ProviderEventPosition;
        currentEventIndex += 1;
        if (activeEntry === null) {
          return Effect.sync(() => pendingEvents.push({ event, position })).pipe(Effect.asVoid);
        }
        return projectEvent(activeEntry, event, position);
      };
      const adapter = yield* adapterFor(input.process.harness)
        .start(transport, {
          cwd: input.cwd,
          providerSessionId: input.process.providerSessionId ?? undefined,
          model: input.model,
          effort: input.effort,
          permissionMode: input.permissionMode,
          onEvent,
        })
        .pipe(
          Effect.provideService(Scope.Scope, scope),
          Effect.mapError((cause) => toPlatformError("start", cause)),
        );
      const entry: HostedProcess = {
        process: input.process,
        adapter,
        pipe: input.pipe,
        hooks: input.hooks,
        dispatchPermit: Semaphore.makeUnsafe(1),
        abort,
      };
      activeEntry = entry;
      hosted.set(input.process.id, entry);
      yield* Effect.forEach(
        pendingEvents,
        ({ event, position }) => projectEvent(entry, event, position),
        { discard: true },
      );
      yield* dispatchNext(entry);
    });

    const submitTurn = Effect.fn("ProtocolHost.submitTurn")(function* (
      sessionId: SessionId,
      input: string,
      author: string | null,
      launchCorrelationId: string | null = null,
    ) {
      const rows = yield* processes.listForSession(sessionId);
      const process = rows.findLast(
        (candidate) =>
          candidate.kind === "agent-protocol" &&
          candidate.exitedAt === null &&
          hosted.has(candidate.id),
      );
      if (process === undefined) {
        return yield* new ProtocolHostNotLiveError({ processId: sessionId });
      }
      const turn = yield* conversations.submitTurn(
        sessionId,
        process.id,
        input,
        author,
        launchCorrelationId,
      );
      const entry = hosted.get(process.id);
      if (entry !== undefined) yield* dispatchNext(entry);
      return turn;
    });

    const interruptTurn = Effect.fn("ProtocolHost.interruptTurn")(function* (turnId: AgentTurnId) {
      const turn = yield* conversations.byTurnId(turnId);
      if (turn === null) return yield* new ProtocolHostNotLiveError({ processId: turnId });
      const entry = hosted.get(turn.processId);
      if (entry === undefined) {
        return yield* new ProtocolHostNotLiveError({ processId: turn.processId });
      }
      yield* entry.adapter
        .interrupt()
        .pipe(Effect.mapError(() => new ProtocolHostNotLiveError({ processId: turn.processId })));
    });

    const respondRequest = Effect.fn("ProtocolHost.respondRequest")(function* (
      request: AgentRequest,
      response:
        | { readonly decision: AgentApprovalDecision; readonly answers?: never }
        | { readonly answers: AgentInputAnswers; readonly decision?: never },
      decidedBy: string,
    ) {
      const entry = hosted.get(request.processId);
      if (entry === undefined) {
        return yield* new ProtocolHostNotLiveError({ processId: request.processId });
      }
      yield* conversations.prepareRequestResponse(request.id, response, decidedBy);
      const sendResponse =
        "decision" in response
          ? entry.adapter.respond(request.providerRequestId, response.decision)
          : entry.adapter.respondInput(request.providerRequestId, response.answers);
      yield* sendResponse.pipe(
        Effect.mapError(() => new ProtocolHostNotLiveError({ processId: request.processId })),
        Effect.tapError(() => conversations.failRequestResponse(request.id)),
      );
      const resolved = yield* conversations.completeRequestResponse(request.id);
      yield* entry.hooks.onRequestChanged(request.sessionId);
      return resolved;
    });

    const detach = Effect.fn("ProtocolHost.detach")(function* (processId: SessionProcessId) {
      const entry = hosted.get(processId);
      if (entry === undefined) return;
      hosted.delete(processId);
      yield* entry.adapter.close();
      entry.abort.abort();
    });

    return ProtocolHost.of({
      attach,
      submitTurn,
      interruptTurn,
      respondRequest,
      detach,
      has: (processId) => Effect.succeed(hosted.has(processId)),
    });
  }),
);

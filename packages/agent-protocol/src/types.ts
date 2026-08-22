import type { AgentApprovalDecision, AgentEvent, AgentInputAnswers } from "@mend/domain/workbench";
import { type Effect, Schema, type Scope, type Stream } from "effect";

/** A protocol adapter could not parse, send, or correlate a provider message. */
export class AgentProtocolError extends Schema.TaggedErrorClass<AgentProtocolError>()(
  "AgentProtocolError",
  {
    adapter: Schema.Literals(["codex", "claude"]),
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

/** Byte transport supplied by the session engine from one Sealant pipe session. */
export interface AgentTransport {
  readonly send: (bytes: Uint8Array) => Effect.Effect<void, AgentProtocolError>;
  readonly output: Stream.Stream<Uint8Array, AgentProtocolError>;
  /** Persist the latest fully handled output position when the decoder is at a line boundary. */
  readonly acknowledgeOutput?: (() => Effect.Effect<void, AgentProtocolError>) | undefined;
  readonly close: () => Effect.Effect<void>;
}

/** Shared options used when a provider conversation starts or resumes. */
export interface AgentStartOptions {
  readonly cwd: string;
  readonly providerSessionId?: string | undefined;
  readonly model?: string | undefined;
  readonly effort?: string | undefined;
  readonly permissionMode: "bypass" | "ask";
  /** Synchronous event projection hook; completion means the event is durable. */
  readonly onEvent?: ((event: AgentEvent) => Effect.Effect<void>) | undefined;
}

/** One live provider conversation over a byte transport. */
export interface AgentSession {
  readonly sendTurn: (input: string) => Effect.Effect<string, AgentProtocolError>;
  readonly interrupt: () => Effect.Effect<void, AgentProtocolError>;
  readonly respond: (
    providerRequestId: string,
    decision: AgentApprovalDecision,
  ) => Effect.Effect<void, AgentProtocolError>;
  readonly respondInput: (
    providerRequestId: string,
    answers: AgentInputAnswers,
  ) => Effect.Effect<void, AgentProtocolError>;
  readonly events: Stream.Stream<AgentEvent>;
  readonly close: () => Effect.Effect<void>;
}

/** A provider-specific stdio protocol implementation. */
export interface AgentAdapter {
  readonly start: (
    transport: AgentTransport,
    options: AgentStartOptions,
  ) => Effect.Effect<AgentSession, AgentProtocolError, Scope.Scope>;
}

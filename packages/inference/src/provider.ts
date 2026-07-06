import type { InferenceContext, InferenceToolName } from "@mend/domain";
import { Effect, Schema } from "effect";
import * as Context from "effect/Context";

export class InferenceError extends Schema.TaggedErrorClass<InferenceError>()("InferenceError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export class InferenceToolError extends Schema.TaggedErrorClass<InferenceToolError>()(
  "InferenceToolError",
  {
    tool: Schema.String,
    message: Schema.String,
  },
) {}

/** JSON Schema for a tool's input — the shape model APIs accept verbatim. */
export interface ToolInputSchema {
  readonly type: "object";
  readonly properties?: Record<string, unknown>;
  readonly required?: Array<string>;
  readonly additionalProperties?: boolean;
  readonly [key: string]: unknown;
}

/**
 * One tool as handed to the provider's tool-calling loop. The name is drawn
 * from the closed set in @mend/domain — there is deliberately no way to hand
 * the loop an arbitrary tool.
 */
export interface InferenceTool {
  readonly name: InferenceToolName;
  readonly description: string;
  readonly inputSchema: ToolInputSchema;
  readonly handle: (input: unknown) => Effect.Effect<unknown, InferenceToolError>;
}

export interface InferenceRequest {
  /** Which interface context is asking — recorded on every audit row. */
  readonly context: InferenceContext;
  readonly system?: string;
  readonly prompt: string;
  readonly tools?: ReadonlyArray<InferenceTool>;
  /** When set, the final answer must be JSON satisfying this schema. */
  readonly outputSchema?: Record<string, unknown>;
}

/**
 * The inference seam (ARCHITECTURE.md §6). The shipped default is Sealant, on
 * the user's connected subscriptions — Mend ships no model keys. Until the SDK
 * grows that surface (PLATFORM-FEEDBACK.md, "Inference on connected
 * accounts"), the dev-only direct layer stands in behind this same contract.
 *
 * Returns the final text, or the decoded JSON value when `outputSchema` was
 * given. Every model exchange and tool call is written to `inference_calls`.
 */
export class InferenceProvider extends Context.Service<
  InferenceProvider,
  {
    readonly respond: (request: InferenceRequest) => Effect.Effect<unknown, InferenceError>;
  }
>()("@mend/inference/InferenceProvider") {}

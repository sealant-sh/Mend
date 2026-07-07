import { PgClient } from "@effect/sql-pg";
import type { InferenceContext, InferenceToolName } from "@mend/domain";
import { Effect, Layer } from "effect";
import * as Context from "effect/Context";

/**
 * The interface-inference audit trail (ARCHITECTURE.md §3, `inference_calls`).
 * Every tool call and model exchange lands here — the log is part of the
 * product's audit surface, not diagnostics.
 */
export class InferenceCallsRepo extends Context.Service<
  InferenceCallsRepo,
  {
    readonly record: (call: {
      readonly context: InferenceContext;
      readonly tool: InferenceToolName | null;
      readonly input: unknown;
      readonly output: unknown;
    }) => Effect.Effect<void>;
  }
>()("@mend/db/InferenceCallsRepo") {
  static readonly layer = Layer.effect(
    InferenceCallsRepo,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;

      const record = Effect.fn("InferenceCallsRepo.record")(function* (call: {
        readonly context: InferenceContext;
        readonly tool: InferenceToolName | null;
        readonly input: unknown;
        readonly output: unknown;
      }) {
        yield* sql`
          INSERT INTO inference_calls (id, context, tool, input, output)
          VALUES (${crypto.randomUUID()}, ${call.context}, ${call.tool}, ${JSON.stringify(call.input) ?? "null"}::jsonb, ${JSON.stringify(call.output) ?? "null"}::jsonb)`.pipe(
          Effect.orDie,
        );
      });

      return { record };
    }),
  );
}

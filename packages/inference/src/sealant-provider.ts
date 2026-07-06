import { Effect, Layer } from "effect";

import { InferenceError, InferenceProvider } from "./provider.ts";

/**
 * The shipped default: inference via Sealant, on the AI subscriptions the user
 * connected there. That surface does not exist in @sealant/sdk 0.4.0 — the
 * only model-access path today is a harness inside a workspace. Recorded as
 * platform feedback (PLATFORM-FEEDBACK.md, "Inference on connected accounts
 * (no workspace)"); when `sealant.inference.respond(...)` ships, this layer
 * gets its implementation and the dev-only direct layer stops being needed.
 */
export const sealantProviderLayer = Layer.succeed(InferenceProvider, {
  respond: () =>
    Effect.fail(
      new InferenceError({
        message:
          "Inference via Sealant is not available yet: @sealant/sdk 0.4.0 exposes no inference " +
          "surface (see PLATFORM-FEEDBACK.md, 'Inference on connected accounts'). " +
          "For development only, provide devDirectProviderLayer instead.",
        cause: null,
      }),
    ),
});

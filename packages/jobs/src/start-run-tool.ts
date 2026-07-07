import { InferenceToolError, StartRun } from "@mend/inference";
import { Effect, Layer } from "effect";

import { RunStarter } from "./dispatcher.ts";

/**
 * The `start_run` tool's live layer — beside the run machinery it drives.
 * The only path by which inference can cause code to change, and it leads
 * into a workspace, recorded like every other run.
 */
export const startRunToolLayer = Layer.effect(
  StartRun,
  Effect.gen(function* () {
    const starter = yield* RunStarter;

    return {
      start: (change, instruction, kind) =>
        starter
          .startOnChange(change, instruction, kind)
          .pipe(
            Effect.mapError(
              (error) => new InferenceToolError({ tool: "start_run", message: error.message }),
            ),
          ),
    };
  }),
);

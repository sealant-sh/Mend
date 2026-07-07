import { RunsRepo } from "@mend/db";
import { FailureBrief, IssueId, RunId } from "@mend/domain";
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

import { InferenceError, InferenceProvider } from "./provider.ts";
import { failureCommentTools } from "./toolset.ts";

/** The `failure-brief` job's payload — enqueued when a run settles failed with a recording. */
export class SummarizeFailureJob extends Schema.Class<SummarizeFailureJob>("SummarizeFailureJob")({
  issueId: IssueId,
  runId: RunId,
}) {}

const SYSTEM = `You sum up a failed run into its failure mini-brief: what was tried, what was observed, and reproduction status. You are Mend's interface inference — you phrase and organize evidence from the recording; you cannot mint claims.

Rules:
- Evidence, not verdicts. Describe what the recording shows, never a judgment. Failures are kept and reported, not softened.
- The recording is the only permitted source of claims. Anything it does not support must be phrased as inferred.
- Each field is a short plain paragraph. reproductionStatus states plainly whether the issue was ever reproduced and where things stand now.
- evidence carries pointers (run id, sequence, one-line excerpt) to the events behind your statements. Sequences are decimal strings.`;

const prompt = (job: SummarizeFailureJob) =>
  `Run ${job.runId} (issue ${job.issueId}) settled failed. Read its recording with read_recording ` +
  `(page and narrow as needed) and answer with the failure mini-brief.`;

/**
 * Sums a failed run's recording into the mini-brief stored on the run row —
 * the `failure-brief` job's worker body. Rendered in-app; the tracker comment
 * lands with M3.
 */
export class FailureSummarizer extends Context.Service<
  FailureSummarizer,
  {
    readonly summarize: (job: SummarizeFailureJob) => Effect.Effect<void, InferenceError>;
  }
>()("@mend/inference/FailureSummarizer") {
  static readonly layer = Layer.effect(
    FailureSummarizer,
    Effect.gen(function* () {
      const provider = yield* InferenceProvider;
      const runs = yield* RunsRepo;
      const tools = yield* failureCommentTools;

      const outputDocument = Schema.toJsonSchemaDocument(FailureBrief);
      const outputSchema: Record<string, unknown> = {
        ...outputDocument.schema,
        ...(Object.keys(outputDocument.definitions).length === 0
          ? {}
          : { $defs: outputDocument.definitions }),
      };

      const summarize = Effect.fn("FailureSummarizer.summarize")(function* (
        job: SummarizeFailureJob,
      ) {
        const answer = yield* provider.respond({
          context: "failure-comment",
          system: SYSTEM,
          prompt: prompt(job),
          tools,
          outputSchema,
        });

        const brief = yield* Schema.decodeUnknownEffect(FailureBrief)(answer).pipe(
          Effect.mapError(
            (error) =>
              new InferenceError({
                message: `the failure mini-brief did not match its schema: ${error.message}`,
                cause: error,
              }),
          ),
        );
        yield* runs.saveFailureBrief(job.runId, brief);
      });

      return { summarize };
    }),
  );
}

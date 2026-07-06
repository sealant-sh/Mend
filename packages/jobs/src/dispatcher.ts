import { IssuesRepo, SettingsRepo } from "@mend/db";
import type { Issue } from "@mend/domain";
import { Config, Duration, Effect, Layer, Option, Schedule } from "effect";
import * as Context from "effect/Context";

/**
 * The M1 seam: what happens when a free mending slot meets the top of the
 * queue. Starting a run (workspace + harness via @mend/sealant, supervised
 * fiber, live card) lands with M1; the dispatcher's shape doesn't change.
 */
export class RunStarter extends Context.Service<
  RunStarter,
  {
    readonly start: (issue: Issue) => Effect.Effect<void>;
  }
>()("@mend/jobs/RunStarter") {
  static readonly noopLayer = Layer.succeed(RunStarter, {
    start: (issue) =>
      Effect.logInfo("dispatcher: run start pending M1 — leaving issue queued").pipe(
        Effect.annotateLogs({ issueId: issue.id }),
      ),
  });
}

/** What one dispatch pass observed and did — returned so tests can assert it. */
export interface DispatchTick {
  readonly concurrency: number;
  readonly mending: number;
  readonly started: boolean;
}

/**
 * The user-visible queue is domain state (`issues.position`), never a job
 * queue. This single loop fills free mending slots from the top of `queued`.
 * Gate 1 stays human: nothing lands in `queued` unless a person dragged it.
 */
export class Dispatcher extends Context.Service<
  Dispatcher,
  {
    readonly tick: () => Effect.Effect<DispatchTick>;
    /** Poll-driven for now; LISTEN/NOTIFY wake-ups arrive with M1. */
    readonly run: () => Effect.Effect<void>;
  }
>()("@mend/jobs/Dispatcher") {
  static readonly layer = Layer.effect(
    Dispatcher,
    Effect.gen(function* () {
      const issues = yield* IssuesRepo;
      const settings = yield* SettingsRepo;
      const starter = yield* RunStarter;
      const interval = yield* Config.duration("MEND_DISPATCH_INTERVAL").pipe(
        Config.orElse(() => Config.succeed(Duration.seconds(5))),
      );

      const tick = Effect.fn("Dispatcher.tick")(function* () {
        const current = yield* settings.get();
        const mending = yield* issues.countByStage("mending");
        const free = current.concurrency - mending;
        if (free <= 0) return { concurrency: current.concurrency, mending, started: false };

        const top = yield* issues.topOfQueued();
        if (Option.isNone(top)) {
          return { concurrency: current.concurrency, mending, started: false };
        }

        yield* starter.start(top.value);
        return { concurrency: current.concurrency, mending, started: true };
      });

      const run = Effect.fn("Dispatcher.run")(function* () {
        yield* Effect.logInfo("dispatcher: polling").pipe(
          Effect.annotateLogs({ interval: Duration.format(interval) }),
        );
        yield* tick().pipe(
          Effect.catchDefect((defect) =>
            Effect.logError("dispatcher: tick died").pipe(Effect.annotateLogs({ defect })),
          ),
          Effect.repeat(Schedule.spaced(interval)),
        );
      });

      return { tick, run };
    }),
  );
}

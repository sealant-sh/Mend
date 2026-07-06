import { Config, Effect, Layer, Redacted, Schema } from "effect";
import * as Context from "effect/Context";
import { PgBoss } from "pg-boss";

export class JobEnqueueError extends Schema.TaggedErrorClass<JobEnqueueError>()("JobEnqueueError", {
  job: Schema.String,
  cause: Schema.Defect(),
}) {}

export interface JobSpec {
  readonly name: string;
  readonly payload: Record<string, unknown>;
  /**
   * Structural, per ARCHITECTURE.md §5: `open-pr:{change_id}`,
   * `merge:{change_id}`, `brief:{change_id}:{head_sha}`. A retried enqueue
   * with the same key never starts a duplicate job.
   */
  readonly idempotencyKey?: string;
  readonly retryLimit?: number;
}

/**
 * The seam over the side-effect job engine. pg-boss is the live layer today;
 * if it ever disappoints, the engine is a layer swap — nothing upstream knows
 * about it (ARCHITECTURE.md §5).
 */
export class JobRunner extends Context.Service<
  JobRunner,
  {
    /** Returns the job id, or null when the idempotency key deduplicated it. */
    readonly enqueue: (job: JobSpec) => Effect.Effect<string | null, JobEnqueueError>;
    /**
     * Register the worker for a job name. Handlers arrive fully provided
     * (R = never); a failed handler fails the job into pg-boss retry, and the
     * dead letter after `retryLimit` stays visible in the jobs schema.
     */
    readonly work: (
      name: string,
      handler: (payload: unknown) => Effect.Effect<void>,
    ) => Effect.Effect<void>;
  }
>()("@mend/jobs/JobRunner") {
  static readonly pgBossLayer = Layer.effect(
    JobRunner,
    Effect.gen(function* () {
      const databaseUrl = yield* Config.redacted("DATABASE_URL").pipe(
        Config.orElse(() =>
          Config.succeed(Redacted.make("postgres://mend:mend@localhost:5433/mend")),
        ),
      );

      const boss = yield* Effect.acquireRelease(
        Effect.promise(async () => {
          const instance = new PgBoss({ connectionString: Redacted.value(databaseUrl) });
          await instance.start();
          return instance;
        }),
        (instance) => Effect.promise(() => instance.stop({ close: true })),
      );

      // pg-boss v10+ requires queues to exist before send/work.
      const knownQueues = new Set<string>();
      const ensureQueue = (name: string) =>
        knownQueues.has(name)
          ? Effect.void
          : Effect.promise(async () => {
              await boss.createQueue(name);
              knownQueues.add(name);
            });

      const enqueue = Effect.fn("JobRunner.enqueue")(function* (job: JobSpec) {
        yield* ensureQueue(job.name).pipe(
          Effect.catchDefect((cause) => new JobEnqueueError({ job: job.name, cause })),
        );
        return yield* Effect.tryPromise({
          try: () =>
            boss.send(job.name, job.payload, {
              ...(job.idempotencyKey === undefined ? {} : { singletonKey: job.idempotencyKey }),
              retryLimit: job.retryLimit ?? 3,
              retryBackoff: true,
            }),
          catch: (cause) => new JobEnqueueError({ job: job.name, cause }),
        });
      });

      const work = Effect.fn("JobRunner.work")(function* (
        name: string,
        handler: (payload: unknown) => Effect.Effect<void>,
      ) {
        yield* ensureQueue(name).pipe(Effect.orDie);
        yield* Effect.promise(() =>
          boss.work(name, async (jobs) => {
            for (const job of jobs) {
              await Effect.runPromise(handler(job.data));
            }
          }),
        );
      });

      return { enqueue, work };
    }),
  );

  /** In-memory engine for tests: enqueue runs the registered handler inline. */
  static readonly testLayer = Layer.sync(JobRunner, () => {
    const handlers = new Map<string, (payload: unknown) => Effect.Effect<void>>();
    const seenKeys = new Set<string>();

    const enqueue = (job: JobSpec): Effect.Effect<string | null, JobEnqueueError> =>
      Effect.gen(function* () {
        if (job.idempotencyKey !== undefined) {
          if (seenKeys.has(job.idempotencyKey)) return null;
          seenKeys.add(job.idempotencyKey);
        }
        const handler = handlers.get(job.name);
        if (handler !== undefined) yield* handler(job.payload);
        return crypto.randomUUID();
      });

    const work = (name: string, handler: (payload: unknown) => Effect.Effect<void>) =>
      Effect.sync(() => void handlers.set(name, handler));

    return { enqueue, work };
  });
}

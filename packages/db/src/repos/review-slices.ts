import { ReviewSliceId, type ChangeId, type CheckpointId } from "@mend/domain";
import { ReviewSlice, type DiffDigest } from "@mend/domain/workbench";
import { and, desc, eq, sql } from "drizzle-orm";
import { Effect, Layer } from "effect";
import * as Context from "effect/Context";

import { MendDB } from "../client.ts";
import { reviewSlices } from "../schema/workbench.ts";

export interface NewReviewSlice {
  readonly changeId: ChangeId;
  readonly checkpointAId: CheckpointId;
  readonly checkpointBId: CheckpointId;
  readonly diffDigest: DiffDigest;
  readonly idempotencyKey: string;
}

class ReviewLockBodyError<E> {
  readonly error: E;

  constructor(error: E) {
    this.error = error;
  }
}

/** Durable immutable Review comparisons and their command idempotency keys. */
export class ReviewSlicesRepo extends Context.Service<
  ReviewSlicesRepo,
  {
    readonly create: (slice: NewReviewSlice) => Effect.Effect<ReviewSlice>;
    /** Serialize checkpoint creation for one change across every Mend server process. */
    readonly withChangeLock: <A, E, R>(
      changeId: ChangeId,
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E, R>;
    readonly byId: (id: ReviewSliceId) => Effect.Effect<ReviewSlice | null>;
    readonly byIdempotencyKey: (
      changeId: ChangeId,
      idempotencyKey: string,
    ) => Effect.Effect<ReviewSlice | null>;
    readonly latestForChange: (changeId: ChangeId) => Effect.Effect<ReviewSlice | null>;
  }
>()("@mend/db/ReviewSlicesRepo") {}

const toReviewSlice = (row: typeof reviewSlices.$inferSelect): ReviewSlice =>
  new ReviewSlice({
    id: row.id,
    changeId: row.changeId,
    checkpointAId: row.checkpointAId,
    checkpointBId: row.checkpointBId,
    diffDigest: row.diffDigest,
    createdAt: row.createdAt,
  });

export const ReviewSlicesRepoLive: Layer.Layer<ReviewSlicesRepo, never, MendDB> = Layer.effect(
  ReviewSlicesRepo,
  Effect.gen(function* () {
    const db = yield* MendDB;

    const withChangeLock = <A, E, R>(
      changeId: ChangeId,
      effect: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E, R> =>
      db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.execute(
              sql`select pg_advisory_xact_lock(hashtext(${`mend:review:${changeId}`}))`,
            );
            return yield* effect.pipe(Effect.mapError((error) => new ReviewLockBodyError(error)));
          }),
        )
        .pipe(
          Effect.catch((error) =>
            error instanceof ReviewLockBodyError ? Effect.fail(error.error) : Effect.die(error),
          ),
        );

    const byIdempotencyKey = Effect.fn("ReviewSlicesRepo.byIdempotencyKey")(function* (
      changeId: ChangeId,
      idempotencyKey: string,
    ) {
      const [row] = yield* db
        .select()
        .from(reviewSlices)
        .where(
          and(eq(reviewSlices.changeId, changeId), eq(reviewSlices.idempotencyKey, idempotencyKey)),
        )
        .limit(1)
        .pipe(Effect.orDie);
      return row === undefined ? null : toReviewSlice(row);
    });

    const create = Effect.fn("ReviewSlicesRepo.create")(function* (slice: NewReviewSlice) {
      const [row] = yield* db
        .insert(reviewSlices)
        .values({ id: ReviewSliceId.make(crypto.randomUUID()), ...slice })
        .onConflictDoNothing({
          target: [reviewSlices.changeId, reviewSlices.idempotencyKey],
        })
        .returning()
        .pipe(Effect.orDie);
      if (row !== undefined) return toReviewSlice(row);
      const existing = yield* byIdempotencyKey(slice.changeId, slice.idempotencyKey);
      if (existing === null) return yield* Effect.die("review slice conflict returned no row");
      return existing;
    });

    const byId = Effect.fn("ReviewSlicesRepo.byId")(function* (id: ReviewSliceId) {
      const [row] = yield* db
        .select()
        .from(reviewSlices)
        .where(eq(reviewSlices.id, id))
        .limit(1)
        .pipe(Effect.orDie);
      return row === undefined ? null : toReviewSlice(row);
    });

    const latestForChange = Effect.fn("ReviewSlicesRepo.latestForChange")(function* (
      changeId: ChangeId,
    ) {
      const [row] = yield* db
        .select()
        .from(reviewSlices)
        .where(eq(reviewSlices.changeId, changeId))
        .orderBy(desc(reviewSlices.createdAt), desc(reviewSlices.id))
        .limit(1)
        .pipe(Effect.orDie);
      return row === undefined ? null : toReviewSlice(row);
    });

    return { create, withChangeLock, byId, byIdempotencyKey, latestForChange };
  }),
);

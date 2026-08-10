import { CheckpointId, type SealantRunId, type SessionId, type Sha } from "@mend/domain";
import { Checkpoint, type CheckpointTrigger } from "@mend/domain/workbench";
import { asc, count, desc, eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import * as Context from "effect/Context";

import { MendDB } from "../client.ts";
import { checkpoints } from "../schema/workbench.ts";

export interface NewCheckpoint {
  readonly sessionId: SessionId;
  readonly ref: string;
  readonly sha: Sha;
  readonly sealantRunId: SealantRunId | null;
  readonly seq: bigint;
  readonly trigger: CheckpointTrigger;
}

/**
 * The checkpoint index (plan §5.6): hidden git ref plus exact record pointer.
 * The refs themselves live in the store's bare repo; this table is how the
 * review picks two of them without touching git.
 */
export class CheckpointsRepo extends Context.Service<
  CheckpointsRepo,
  {
    readonly create: (checkpoint: NewCheckpoint) => Effect.Effect<Checkpoint>;
    readonly listForSession: (sessionId: SessionId) => Effect.Effect<ReadonlyArray<Checkpoint>>;
    readonly latestForSession: (sessionId: SessionId) => Effect.Effect<Checkpoint | null>;
    /** Next checkpoint index = count; the engine serializes per-session snapshots. */
    readonly countForSession: (sessionId: SessionId) => Effect.Effect<number>;
  }
>()("@mend/db/CheckpointsRepo") {}

const toCheckpoint = (row: typeof checkpoints.$inferSelect): Checkpoint => new Checkpoint(row);

export const CheckpointsRepoLive: Layer.Layer<CheckpointsRepo, never, MendDB> = Layer.effect(
  CheckpointsRepo,
  Effect.gen(function* () {
    const db = yield* MendDB;

    const create = Effect.fn("CheckpointsRepo.create")(function* (checkpoint: NewCheckpoint) {
      const [created] = yield* db
        .insert(checkpoints)
        .values({ id: CheckpointId.make(crypto.randomUUID()), ...checkpoint })
        .returning()
        .pipe(Effect.orDie);
      if (created === undefined) return yield* Effect.die("checkpoint insert returned no row");
      return toCheckpoint(created);
    });

    const listForSession = Effect.fn("CheckpointsRepo.listForSession")(function* (
      sessionId: SessionId,
    ) {
      const rows = yield* db
        .select()
        .from(checkpoints)
        .where(eq(checkpoints.sessionId, sessionId))
        .orderBy(asc(checkpoints.createdAt), asc(checkpoints.id))
        .pipe(Effect.orDie);
      return rows.map(toCheckpoint);
    });

    const latestForSession = Effect.fn("CheckpointsRepo.latestForSession")(function* (
      sessionId: SessionId,
    ) {
      const [row] = yield* db
        .select()
        .from(checkpoints)
        .where(eq(checkpoints.sessionId, sessionId))
        .orderBy(desc(checkpoints.createdAt), desc(checkpoints.id))
        .limit(1)
        .pipe(Effect.orDie);
      return row === undefined ? null : toCheckpoint(row);
    });

    const countForSession = Effect.fn("CheckpointsRepo.countForSession")(function* (
      sessionId: SessionId,
    ) {
      const [row] = yield* db
        .select({ value: count() })
        .from(checkpoints)
        .where(eq(checkpoints.sessionId, sessionId))
        .pipe(Effect.orDie);
      return row?.value ?? 0;
    });

    return { create, listForSession, latestForSession, countForSession };
  }),
);

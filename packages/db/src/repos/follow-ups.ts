import { FollowUpId, type ChangeId, type SessionId } from "@mend/domain";
import { FollowUp } from "@mend/domain/workbench";
import { and, desc, eq } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

import { MendDB } from "../client.ts";
import { followUps } from "../schema/workbench.ts";

export class FollowUpNotFoundError extends Schema.TaggedErrorClass<FollowUpNotFoundError>()(
  "FollowUpNotFoundError",
  {
    sessionId: Schema.String,
  },
) {}

/**
 * Assembled review bundles (plan §7.3). One pending follow-up per session at
 * a time — creating a new one supersedes the previous pending row, so the
 * session always picks up exactly what the user last approved.
 */
export class FollowUpsRepo extends Context.Service<
  FollowUpsRepo,
  {
    readonly create: (
      sessionId: SessionId,
      changeId: ChangeId,
      instruction: string,
    ) => Effect.Effect<FollowUp>;
    readonly pendingForSession: (sessionId: SessionId) => Effect.Effect<FollowUp | null>;
    readonly markDelivered: (id: FollowUpId) => Effect.Effect<void>;
  }
>()("@mend/db/FollowUpsRepo") {}

const toFollowUp = (row: typeof followUps.$inferSelect): FollowUp => new FollowUp(row);

export const FollowUpsRepoLive: Layer.Layer<FollowUpsRepo, never, MendDB> = Layer.effect(
  FollowUpsRepo,
  Effect.gen(function* () {
    const db = yield* MendDB;

    const create = Effect.fn("FollowUpsRepo.create")(
      (sessionId: SessionId, changeId: ChangeId, instruction: string) =>
        db
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* tx
                .update(followUps)
                .set({ status: "superseded" })
                .where(and(eq(followUps.sessionId, sessionId), eq(followUps.status, "pending")));
              const [created] = yield* tx
                .insert(followUps)
                .values({
                  id: FollowUpId.make(crypto.randomUUID()),
                  sessionId,
                  changeId,
                  instruction,
                })
                .returning();
              if (created === undefined)
                return yield* Effect.die("follow-up insert returned no row");
              return toFollowUp(created);
            }),
          )
          .pipe(Effect.orDie),
    );

    const pendingForSession = Effect.fn("FollowUpsRepo.pendingForSession")(function* (
      sessionId: SessionId,
    ) {
      const [row] = yield* db
        .select()
        .from(followUps)
        .where(and(eq(followUps.sessionId, sessionId), eq(followUps.status, "pending")))
        .orderBy(desc(followUps.createdAt))
        .limit(1)
        .pipe(Effect.orDie);
      return row === undefined ? null : toFollowUp(row);
    });

    const markDelivered = Effect.fn("FollowUpsRepo.markDelivered")(function* (id: FollowUpId) {
      yield* db
        .update(followUps)
        .set({ status: "delivered", deliveredAt: new Date() })
        .where(eq(followUps.id, id))
        .pipe(Effect.orDie);
    });

    return { create, pendingForSession, markDelivered };
  }),
);

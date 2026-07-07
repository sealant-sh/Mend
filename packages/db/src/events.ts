import type { PgClient } from "@effect/sql-pg";
import { Effect, Schema } from "effect";

/**
 * One NOTIFY channel carries every domain change; the SSE endpoint and the
 * dispatcher wake on it instead of tight-polling. Payloads are small pointers
 * ("something about this issue/run changed") — clients re-read state through
 * the API, they never trust the payload as data.
 */
export const MEND_EVENTS_CHANNEL = "mend_events";

export const MendEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literals(["issue"]),
    issueId: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literals(["run"]),
    runId: Schema.String,
    issueId: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literals(["run-progress"]),
    runId: Schema.String,
    issueId: Schema.String,
    sequence: Schema.String,
    line: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literals(["brief"]),
    changeId: Schema.String,
    issueId: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literals(["brief-comment"]),
    briefId: Schema.String,
    issueId: Schema.String,
  }),
]);
export type MendEvent = typeof MendEvent.Type;

const encodeEvent = Schema.encodeEffect(Schema.fromJsonString(MendEvent));

export const notifyEvent = (sql: PgClient.PgClient, event: MendEvent) =>
  Effect.gen(function* () {
    const payload = yield* encodeEvent(event).pipe(Effect.orDie);
    yield* sql.notify(MEND_EVENTS_CHANNEL, payload).pipe(Effect.orDie);
  });

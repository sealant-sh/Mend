import { PgClient } from "@effect/sql-pg";
import { Auth } from "@mend/auth";
import { MEND_EVENTS_CHANNEL } from "@mend/db";
import { Effect, Option, Schedule, Stream } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";

const encoder = new TextEncoder();

/**
 * Live updates over SSE (ARCHITECTURE.md §4): one stream carrying pointer
 * events from the `mend_events` NOTIFY channel — queue changes, run status,
 * run progress. Clients re-read state through the API on receipt; the comment
 * heartbeat keeps proxies from closing the idle connection.
 */
export const EventsRoutes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    const auth = yield* Auth;

    yield* router.add("GET", "/api/events", (request) =>
      Effect.gen(function* () {
        const headers = new Headers(Object.entries(request.headers));
        const session = yield* auth.getSession(headers);
        if (Option.isNone(session)) return HttpServerResponse.empty({ status: 401 });

        const events = sql.listen(MEND_EVENTS_CHANNEL).pipe(
          Stream.map((payload) => `data: ${payload}\n\n`),
          Stream.orDie,
        );
        const heartbeat = Stream.fromSchedule(Schedule.spaced("25 seconds")).pipe(
          Stream.map(() => ": ping\n\n"),
        );

        return HttpServerResponse.stream(
          Stream.merge(events, heartbeat).pipe(Stream.map((chunk) => encoder.encode(chunk))),
          {
            contentType: "text/event-stream",
            headers: { "cache-control": "no-cache", connection: "keep-alive" },
          },
        );
      }),
    );
  }),
);

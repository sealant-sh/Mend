import { Auth } from "@mend/auth";
import { SessionsRepo } from "@mend/db";
import { SessionId } from "@mend/domain";
import { SealantClient } from "@mend/sealant";
import { Effect, Option, Schedule, Schema, Stream } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";

const encoder = new TextEncoder();

const InputBody = Schema.Struct({ data: Schema.String });
const ResizeBody = Schema.Struct({ cols: Schema.Int, rows: Schema.Int });
const decodeInput = Schema.decodeUnknownEffect(InputBody);
const decodeResize = Schema.decodeUnknownEffect(ResizeBody);

/**
 * The terminal proxy (plan §8.1.F): the CLI (and later the phone) reaches a
 * session's platform PTY through Mend, never the control plane directly —
 * Mend's token is the only credential a client holds. Output is SSE frames of
 * base64 chunks with their durable sequence (`?from=` resumes/replays); input
 * and resize are plain POSTs. Query-param addressing keeps the raw router
 * simple: `?session=<id>`.
 */
export const TtyRoutes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const auth = yield* Auth;
    const sessions = yield* SessionsRepo;
    const sealant = yield* SealantClient;

    const authorized = (request: { readonly headers: Record<string, string | string[]> }) =>
      Effect.gen(function* () {
        const headers = new Headers(
          Object.entries(request.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : v]),
        );
        return yield* auth.getSession(headers);
      });

    /** Session row → live PTY handle, or a response describing why not. */
    const resolvePty = (sessionParam: string | null) =>
      Effect.gen(function* () {
        if (sessionParam === null) {
          return { error: HttpServerResponse.text("missing ?session", { status: 400 }) };
        }
        const session = yield* sessions.byId(SessionId.make(sessionParam)).pipe(Effect.option);
        if (Option.isNone(session)) {
          return { error: HttpServerResponse.text("unknown session", { status: 404 }) };
        }
        const { sealantWorkspaceId, sealantSessionId } = session.value;
        if (sealantWorkspaceId === null || sealantSessionId === null) {
          return {
            error: HttpServerResponse.text("session has no platform PTY", { status: 409 }),
          };
        }
        const workspace = yield* sealant.getWorkspace(sealantWorkspaceId);
        const pty = yield* sealant.getSession(workspace, sealantSessionId);
        return { pty };
      }).pipe(
        Effect.catchTag("SealantPlatformError", (error) =>
          Effect.succeed({ error: HttpServerResponse.text(error.message, { status: 502 }) }),
        ),
      );

    yield* router.add("GET", "/api/tty", (request) =>
      Effect.gen(function* () {
        const session = yield* authorized(request);
        if (Option.isNone(session)) return HttpServerResponse.empty({ status: 401 });
        const url = new URL(request.url, "http://mend.local");
        const resolved = yield* resolvePty(url.searchParams.get("session"));
        if (!("pty" in resolved) || resolved.pty === undefined) return resolved.error;
        const pty = resolved.pty;
        const from = BigInt(url.searchParams.get("from") ?? "0");

        const output = Stream.fromAsyncIterable(
          pty.output({ from }),
          (cause) => new Error(`pty output failed: ${String(cause)}`),
        ).pipe(
          Stream.map(
            (chunk) =>
              `data: ${JSON.stringify({
                seq: String(chunk.sequence),
                data: Buffer.from(chunk.data).toString("base64"),
              })}\n\n`,
          ),
          // The iterable ends when the session settles — say so explicitly.
          Stream.concat(Stream.make("event: end\ndata: {}\n\n")),
          Stream.orDie,
        );
        const heartbeat = Stream.fromSchedule(Schedule.spaced("20 seconds")).pipe(
          Stream.map(() => ": ping\n\n"),
        );
        return HttpServerResponse.stream(
          Stream.merge(output, heartbeat, { haltStrategy: "left" }).pipe(
            Stream.map((chunk) => encoder.encode(chunk)),
          ),
          {
            contentType: "text/event-stream",
            headers: { "cache-control": "no-cache", connection: "keep-alive" },
          },
        );
      }),
    );

    yield* router.add("POST", "/api/tty/input", (request) =>
      Effect.gen(function* () {
        const session = yield* authorized(request);
        if (Option.isNone(session)) return HttpServerResponse.empty({ status: 401 });
        const url = new URL(request.url, "http://mend.local");
        const resolved = yield* resolvePty(url.searchParams.get("session"));
        if (!("pty" in resolved) || resolved.pty === undefined) return resolved.error;
        const body = yield* request.json.pipe(Effect.orDie);
        const input = yield* decodeInput(body).pipe(Effect.orDie);
        yield* Effect.tryPromise({
          try: () => resolved.pty.send(new Uint8Array(Buffer.from(input.data, "base64"))),
          catch: (cause) => new Error(String(cause)),
        }).pipe(Effect.orDie);
        return HttpServerResponse.empty({ status: 204 });
      }),
    );

    yield* router.add("POST", "/api/tty/resize", (request) =>
      Effect.gen(function* () {
        const session = yield* authorized(request);
        if (Option.isNone(session)) return HttpServerResponse.empty({ status: 401 });
        const url = new URL(request.url, "http://mend.local");
        const resolved = yield* resolvePty(url.searchParams.get("session"));
        if (!("pty" in resolved) || resolved.pty === undefined) return resolved.error;
        const body = yield* request.json.pipe(Effect.orDie);
        const size = yield* decodeResize(body).pipe(Effect.orDie);
        yield* Effect.tryPromise({
          try: () => resolved.pty.resize(size.cols, size.rows),
          catch: (cause) => new Error(String(cause)),
        }).pipe(Effect.orDie);
        return HttpServerResponse.empty({ status: 204 });
      }),
    );
  }),
);

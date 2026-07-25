import { Auth } from "@mend/auth";
import { SessionsRepo } from "@mend/db";
import { SessionId } from "@mend/domain";
import { SealantClient } from "@mend/sealant";
import { Effect, Option } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { Socket } from "effect/unstable/socket";

/**
 * The terminal proxy (plan §8.1.F) as a DATA PLANE: one WebSocket per attach.
 * The CLI (and later the phone/web pane) reaches a session's platform PTY
 * through Mend, never the control plane directly — Mend's token is the only
 * credential a client holds. Auth happens ONCE at the upgrade, the platform
 * attachment (`session.attach`, itself one held WebSocket to the control
 * plane's held daemon connection) is opened ONCE, and after that a keystroke
 * is a binary frame on open sockets — no per-event auth, DB, HTTP, or
 * process spawns anywhere on the path.
 *
 * Wire protocol (mirrors the platform's `sealant.attach.v1`):
 *   server → client   binary = PTY output bytes (replay from `?from=`, then live)
 *   server → client   text   = `{"t":"end"}` then close (session settled)
 *   client → server   binary = PTY input bytes
 *   client → server   text   = `{"t":"resize","cols":n,"rows":n}`
 *
 * Auth: session cookie (browser) or `?token=` (CLI; WebSocket cannot set
 * headers). Addressing stays query-param: `?session=<id>&from=<seq>`.
 */
export const TtyRoutes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const auth = yield* Auth;
    const sessions = yield* SessionsRepo;
    const sealant = yield* SealantClient;

    yield* router.add("GET", "/api/tty", (request) =>
      Effect.gen(function* () {
        const url = new URL(request.url, "http://mend.local");

        // Authenticate once, before upgrading. Browser clients carry the
        // cookie; the CLI passes its bearer as ?token= and it is folded into
        // the header shape better-auth expects.
        const headers = new Headers(
          Object.entries(request.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : v]),
        );
        const token = url.searchParams.get("token");
        if (!headers.has("authorization") && token !== null) {
          headers.set("authorization", `Bearer ${token}`);
        }
        const authed = yield* auth.getSession(headers);
        if (Option.isNone(authed)) return HttpServerResponse.empty({ status: 401 });

        const sessionParam = url.searchParams.get("session");
        if (sessionParam === null) {
          return HttpServerResponse.text("missing ?session", { status: 400 });
        }
        const session = yield* sessions.byId(SessionId.make(sessionParam)).pipe(Effect.option);
        if (Option.isNone(session)) {
          return HttpServerResponse.text("unknown session", { status: 404 });
        }
        const { sealantWorkspaceId, sealantSessionId } = session.value;
        if (sealantWorkspaceId === null || sealantSessionId === null) {
          return HttpServerResponse.text("session has no platform PTY", { status: 409 });
        }
        const from = BigInt(url.searchParams.get("from") ?? "0");

        const resolved = yield* Effect.gen(function* () {
          const workspace = yield* sealant.getWorkspace(sealantWorkspaceId);
          const pty = yield* sealant.getSession(workspace, sealantSessionId);
          const attachment = yield* Effect.tryPromise({
            try: () => pty.attach({ from }),
            catch: (cause) => new Error(`attach failed: ${String(cause)}`),
          }).pipe(Effect.orDie);
          return { ok: true as const, attachment };
        }).pipe(
          Effect.catchTag("SealantPlatformError", (error) =>
            Effect.succeed({ ok: false as const, message: error.message }),
          ),
        );
        if (!resolved.ok) return HttpServerResponse.text(resolved.message, { status: 502 });
        const attachment = resolved.attachment;

        // The pump, scope-bound to this handler fiber: the client closing the
        // socket interrupts it, and the finalizer drops the platform
        // attachment (the session itself keeps running).
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() => Effect.sync(() => attachment.close()));
            const socket = yield* request.upgrade;
            const write = yield* socket.writer;

            const iterator = attachment.output[Symbol.asyncIterator]();
            const pumpOutput = Effect.gen(function* () {
              for (;;) {
                const next = yield* Effect.promise(() => iterator.next());
                if (next.done === true) break;
                yield* write(next.value);
              }
              yield* write(JSON.stringify({ t: "end" }));
              yield* write(new Socket.CloseEvent(1000, "session settled"));
            }).pipe(Effect.ignore);
            yield* Effect.forkScoped(pumpOutput);

            yield* socket
              .runRaw((data) => {
                if (typeof data !== "string") {
                  attachment.send(data);
                  return Effect.void;
                }
                try {
                  const frame = JSON.parse(data) as {
                    readonly t?: string;
                    readonly cols?: number;
                    readonly rows?: number;
                  };
                  if (
                    frame.t === "resize" &&
                    typeof frame.cols === "number" &&
                    typeof frame.rows === "number"
                  ) {
                    attachment.resize(frame.cols, frame.rows);
                  }
                } catch {
                  // Unknown text frame — ignore.
                }
                return Effect.void;
              })
              .pipe(Effect.ignore);
          }),
        );

        return HttpServerResponse.empty();
      }),
    );
  }),
);

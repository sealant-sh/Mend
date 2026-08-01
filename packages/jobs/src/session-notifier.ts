import { PgClient } from "@effect/sql-pg";
import {
  MEND_EVENTS_CHANNEL,
  MendEvent,
  ProjectsRepo,
  PushDevicesRepo,
  SessionsRepo,
} from "@mend/db";
import { SessionId } from "@mend/domain";
import type { Session } from "@mend/domain/workbench";
import { Effect, Layer, Schema, Stream } from "effect";

/**
 * Pushes a notification to registered phones when a session needs the user:
 * it settled (completed · failed) or is waiting for input. The suppression
 * discipline is ported from t3code (MIT — pingdotgg/t3code relay), which
 * exists because every guard here is a bug they shipped without:
 *
 * - phase, not status: `waiting`/`idle` collapse to one "attention" phase so
 *   flapping between them can't re-ring; `starting`/`running`/`stopped` never
 *   notify (stopped is the user's own hand).
 * - known baseline only: a session first seen mid-flight records its phase
 *   silently — reconnecting or restarting the server must not buzz the phone.
 * - freshness: a terminal state older than two minutes is history, not news.
 */

type Phase = "attention" | "completed" | "failed";

const TERMINAL_FRESHNESS_MS = 2 * 60_000;
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const BODY_LIMIT = 140;

export const phaseOf = (status: string): Phase | null => {
  switch (status) {
    case "waiting":
    case "idle":
      return "attention";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return null;
  }
};

export const notificationBody = (session: Session, phase: Phase): string => {
  const name = session.label ?? session.harness;
  if (phase === "attention") return `${name} is waiting on you`;
  const summary =
    session.summary === null || session.summary === ""
      ? ""
      : `: ${session.summary.length > BODY_LIMIT ? `${session.summary.slice(0, BODY_LIMIT)}…` : session.summary}`;
  return phase === "completed" ? `${name} completed${summary}` : `${name} failed${summary}`;
};

interface ExpoPushTicket {
  readonly status: string;
  readonly details?: { readonly error?: string };
}

const decodeEvent = Schema.decodeUnknownEffect(Schema.fromJsonString(MendEvent));

export const SessionNotifierLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    const sessions = yield* SessionsRepo;
    const projects = yield* ProjectsRepo;
    const devices = yield* PushDevicesRepo;

    const lastPhase = new Map<string, Phase | null>();

    const send = Effect.fn("SessionNotifier.send")(function* (session: Session, phase: Phase) {
      const targets = yield* devices.list();
      if (targets.length === 0) return;
      const title = yield* projects.byId(session.projectId).pipe(
        Effect.map((project) => project.name),
        Effect.orElseSucceed(() => session.harness),
      );
      const messages = targets.map((device) => ({
        to: device.token,
        title,
        body: notificationBody(session, phase),
        data: { sessionId: session.id, projectId: session.projectId },
        sound: "default",
      }));
      const tickets = yield* Effect.tryPromise({
        try: async (): Promise<ReadonlyArray<ExpoPushTicket>> => {
          const response = await fetch(EXPO_PUSH_URL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(messages),
          });
          if (!response.ok) throw new Error(`expo push → ${response.status}`);
          const parsed = (await response.json()) as { data?: ReadonlyArray<ExpoPushTicket> };
          return parsed.data ?? [];
        },
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      });
      // Tickets align with the request order; a dead token is pruned, not retried.
      yield* Effect.forEach(
        tickets.flatMap((ticket, index) =>
          ticket.details?.error === "DeviceNotRegistered" && targets[index] !== undefined
            ? [targets[index].token]
            : [],
        ),
        (token) => devices.remove(token),
      );
    });

    const observe = Effect.fn("SessionNotifier.observe")(function* (sessionId: string) {
      const session = yield* sessions.byId(SessionId.make(sessionId));
      const phase = phaseOf(session.status);
      const previous = lastPhase.get(session.id);
      lastPhase.set(session.id, phase);
      if (previous === undefined) return; // unknown baseline — record, never ring
      if (previous === phase || phase === null) return;
      if (phase !== "attention") {
        const settledAt = session.settledAt?.getTime() ?? Date.now();
        if (Date.now() - settledAt > TERMINAL_FRESHNESS_MS) return;
      }
      yield* send(session, phase);
    });

    // Baseline: whatever is live right now was live before we were listening.
    const active = yield* sessions.listActive();
    for (const session of active) lastPhase.set(session.id, phaseOf(session.status));

    yield* sql.listen(MEND_EVENTS_CHANNEL).pipe(
      Stream.runForEach((payload) =>
        decodeEvent(payload).pipe(
          Effect.flatMap((event) =>
            event.type === "session" ? observe(event.sessionId) : Effect.void,
          ),
          Effect.catchCause((cause) =>
            Effect.logWarning("session notifier: event handling failed").pipe(
              Effect.annotateLogs({ cause: String(cause) }),
            ),
          ),
        ),
      ),
      Effect.catchCause((cause) =>
        Effect.logWarning("session notifier: listen stream ended").pipe(
          Effect.annotateLogs({ cause: String(cause) }),
        ),
      ),
      Effect.forkScoped,
    );
  }),
);

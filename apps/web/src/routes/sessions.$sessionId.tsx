import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useState } from "react";

import { AppShell } from "#/components/shell";
import { SessionStatusDot } from "#/components/status";
import { SessionTerminal } from "#/components/terminal";
import { checkpointSession, stopSession, type WorkbenchEventDto } from "#/lib/api";
import { pendingFollowUpQuery, queryClient, sessionDetailQuery } from "#/lib/queries";
import { useWorkbenchEvents } from "#/lib/workbench-events";

export const Route = createFileRoute("/sessions/$sessionId")({
  ssr: false,
  loader: async ({ params }) => {
    await queryClient.ensureQueryData(sessionDetailQuery(params.sessionId));
  },
  component: SessionPage,
});

const ACTIVE = new Set(["starting", "running", "waiting", "idle"]);

function SessionPage() {
  const { sessionId } = Route.useParams();
  const { session, checkpoints, change } = useSuspenseQuery(sessionDetailQuery(sessionId)).data;
  const followUp = useSuspenseQuery(pendingFollowUpQuery(sessionId)).data;
  const [lines, setLines] = useState<ReadonlyArray<string>>([]);
  const [pending, setPending] = useState<"stop" | "checkpoint" | null>(null);

  const onEvent = useCallback(
    (event: WorkbenchEventDto) => {
      if (event.type === "session-progress" && event.sessionId === sessionId) {
        const line = `${event.sequence ?? ""}  ${event.line ?? ""}`;
        setLines((current) => [...current.slice(-199), line]);
      }
    },
    [sessionId],
  );
  useWorkbenchEvents(onEvent);

  const act = (kind: "stop" | "checkpoint") => {
    setPending(kind);
    const action =
      kind === "stop" ? stopSession(sessionId) : checkpointSession(sessionId, "user-mark");
    void action
      .then(() => queryClient.invalidateQueries({ queryKey: ["session", sessionId] }))
      .finally(() => setPending(null));
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-[1100px]">
        <p className="ev-eyebrow">session</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
          <h1 className="font-display text-3xl font-medium tracking-tight text-foreground">
            {session.harness}
            {session.label === null ? "" : ` — ${session.label}`}
          </h1>
          <SessionStatusDot status={session.status} recorded={session.sealantRunId !== null} />
        </div>
        <p className="mt-2 font-mono text-xs text-faint">
          {session.branch} · worktree {session.worktree} · base {session.baseSha.slice(0, 12)}
          {session.startedAt === null
            ? ""
            : ` · started ${new Date(session.startedAt).toLocaleTimeString()}`}
        </p>
        {session.summary !== null && (
          <p className="mt-3 max-w-[760px] text-[14.5px] leading-relaxed text-ink-2">
            {session.summary}
          </p>
        )}
        {/* Legacy note for settled pre-platform sessions only — a session that is
            still ACTIVE without a run is provisioning, not unsupervised. */}
        {session.sealantRunId === null && !ACTIVE.has(session.status) && (
          <p className="mt-3 font-mono text-xs text-warning">
            recording: off — launched before the platform&apos;s supervised path; worktree,
            checkpoints, and review are live
          </p>
        )}
        {followUp !== null && (
          <p className="mt-3 font-mono text-xs text-warning">
            follow-up pending — resume this session with{" "}
            <span className="text-ink-2">mend continue</span> in a terminal
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {change !== null && (
            <Link
              to="/changes/$changeId"
              params={{ changeId: change.id }}
              className="rounded-xl bg-primary px-4 py-2 font-sans text-sm font-medium text-primary-foreground no-underline shadow-[var(--shadow-cobalt)] transition-transform hover:-translate-y-0.5"
            >
              Review the change
            </Link>
          )}
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => act("checkpoint")}
            className="rounded-xl border border-border bg-card px-4 py-2 font-sans text-sm font-medium text-foreground shadow-xs transition-opacity disabled:opacity-50"
          >
            {pending === "checkpoint" ? "Marking…" : "Mark checkpoint"}
          </button>
          {ACTIVE.has(session.status) && (
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => act("stop")}
              className="font-sans text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {pending === "stop" ? "Stopping…" : "Stop"}
            </button>
          )}
        </div>

        <div className="mt-9 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="min-w-0">
            {session.sealantSessionId === null && ACTIVE.has(session.status) ? (
              <>
                <p className="text-xs font-medium text-label">Terminal</p>
                <div className="mt-3 overflow-hidden rounded-2xl bg-card shadow-sm">
                  <div className="border-b border-rule-faint bg-secondary px-4 py-2">
                    <p className="font-mono text-[11.5px] text-muted-foreground">
                      provisioning workspace — a first launch builds the harness image (can take
                      minutes)…
                    </p>
                  </div>
                  <p className="p-4 font-mono text-xs text-faint">
                    The terminal attaches here the moment the PTY is live.
                  </p>
                </div>
              </>
            ) : session.sealantSessionId !== null && ACTIVE.has(session.status) ? (
              <>
                <p className="text-xs font-medium text-label">Terminal</p>
                <div className="mt-3 overflow-hidden rounded-2xl bg-card shadow-sm">
                  <div className="flex items-center gap-2 border-b border-rule-faint bg-secondary px-4 py-2">
                    <span className="size-1.5 animate-pulse rounded-full bg-[var(--sw-red)]" />
                    <p className="font-mono text-[11.5px] text-muted-foreground">
                      run {session.sealantRunId} · live — the same session your terminal holds
                    </p>
                  </div>
                  {/* Keyed on the PLATFORM session: `mend continue` reopens the
                      session with a fresh PTY, and the pane must reconnect. */}
                  <SessionTerminal key={session.sealantSessionId} sessionId={session.id} />
                </div>
              </>
            ) : (
              <>
                <p className="text-xs font-medium text-label">Record</p>
                <div className="mt-3 overflow-hidden rounded-2xl bg-card shadow-sm">
                  <div className="border-b border-rule-faint bg-secondary px-4 py-2">
                    <p className="font-mono text-[11.5px] text-muted-foreground">
                      {session.sealantRunId === null
                        ? "no record — the session was not supervised"
                        : `run ${session.sealantRunId}`}
                    </p>
                  </div>
                  <div className="max-h-[480px] overflow-y-auto p-4">
                    {lines.length === 0 ? (
                      <p className="font-mono text-xs text-faint">
                        {session.sealantRunId === null
                          ? "Progress appears here once sessions launch supervised."
                          : "The session is settled — open the change for the reviewed diff."}
                      </p>
                    ) : (
                      lines.map((line, index) => (
                        <p key={index} className="font-mono text-xs leading-6 text-ink-2">
                          {line}
                        </p>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </section>

          <section>
            <p className="text-xs font-medium text-label">Checkpoints</p>
            <div className="mt-3 overflow-hidden rounded-2xl bg-card shadow-sm">
              {checkpoints.length === 0 ? (
                <p className="p-4 font-mono text-xs text-faint">none yet</p>
              ) : (
                checkpoints.map((checkpoint, index) => (
                  <div
                    key={checkpoint.id}
                    className={`px-4 py-3 ${index === 0 ? "" : "border-t border-rule-faint"}`}
                  >
                    <p className="font-mono text-xs text-ink-2">
                      {index} · {checkpoint.trigger}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-faint">
                      {checkpoint.sha.slice(0, 12)} · seq {checkpoint.seq} ·{" "}
                      {new Date(checkpoint.createdAt).toLocaleTimeString()}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}

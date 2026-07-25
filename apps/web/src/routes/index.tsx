import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useState } from "react";

import { AppShell } from "#/components/shell";
import { SessionStatusDot } from "#/components/status";
import type { SessionDto, WorkbenchEventDto } from "#/lib/api";
import { activeSessionsQuery, projectsQuery, queryClient } from "#/lib/queries";
import { useWorkbenchEvents } from "#/lib/workbench-events";

export const Route = createFileRoute("/")({
  ssr: false,
  loader: async () => {
    await Promise.all([
      queryClient.ensureQueryData(activeSessionsQuery),
      queryClient.ensureQueryData(projectsQuery),
    ]);
  },
  component: NowPage,
});

/** The attention inbox (plan §6.1): what runs, what waits, nothing decorative. */
function NowPage() {
  const sessions = useSuspenseQuery(activeSessionsQuery).data;
  const projects = useSuspenseQuery(projectsQuery).data;
  const [progress, setProgress] = useState<Readonly<Record<string, string>>>({});

  const onEvent = useCallback((event: WorkbenchEventDto) => {
    if (event.type === "session-progress" && event.sessionId !== undefined) {
      const sessionId = event.sessionId;
      const line = event.line ?? "";
      setProgress((current) => ({ ...current, [sessionId]: line }));
    }
  }, []);
  useWorkbenchEvents(onEvent);

  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? id.slice(0, 8);
  const waiting = sessions.filter((s) => s.status === "waiting");
  const active = sessions.filter((s) => s.status !== "waiting");

  return (
    <AppShell>
      <div className="mx-auto max-w-[760px]">
        <p className="ev-eyebrow">now</p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-foreground">
          What needs you
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {sessions.length === 0
            ? "Nothing running. Start one from a terminal: mend codex"
            : `${waiting.length === 0 ? "Nothing waiting on you" : `${waiting.length} waiting`} · ${sessions.length} session${sessions.length === 1 ? "" : "s"} active`}
        </p>

        {waiting.length > 0 && (
          <Section label="Needs you">
            {waiting.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                project={projectName(session.projectId)}
                progressLine={progress[session.id]}
              />
            ))}
          </Section>
        )}

        <Section label="Active">
          {active.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No active sessions. <span className="font-mono text-xs">mend codex</span> in an
              adopted repository starts one.
            </p>
          ) : (
            active.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                project={projectName(session.projectId)}
                progressLine={progress[session.id]}
              />
            ))
          )}
        </Section>
      </div>
    </AppShell>
  );
}

function Section({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="mt-9">
      <p className="text-xs font-medium text-label">{label}</p>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

function SessionCard({
  session,
  project,
  progressLine,
}: {
  readonly session: SessionDto;
  readonly project: string;
  readonly progressLine: string | undefined;
}) {
  return (
    <div className="rounded-2xl bg-card p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between gap-4">
        <p className="font-sans text-sm font-medium text-foreground">
          {session.harness} · {project}
        </p>
        <SessionStatusDot status={session.status} recorded={session.sealantRunId !== null} />
      </div>
      {session.label !== null && (
        <p className="mt-2 text-[14.5px] leading-relaxed text-ink-2">“{session.label}”</p>
      )}
      <div className="mt-3 flex items-center justify-between gap-4">
        <p className="truncate font-mono text-xs text-faint">
          {progressLine ?? `${session.branch} · worktree ${session.worktree}`}
        </p>
        <Link
          to="/sessions/$sessionId"
          params={{ sessionId: session.id }}
          className="shrink-0 font-sans text-sm font-medium text-muted-foreground no-underline transition-colors hover:text-foreground"
        >
          Watch
        </Link>
      </div>
    </div>
  );
}

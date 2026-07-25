import { useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";

import { AppShell } from "#/components/shell";
import { SessionStatusDot } from "#/components/status";
import {
  createSession,
  launchSession,
  resumeSession,
  type SessionDto,
  type WorkbenchEventDto,
} from "#/lib/api";
import { projectDetailQuery, projectsQuery, queryClient } from "#/lib/queries";
import { useWorkbenchEvents } from "#/lib/workbench-events";

export const Route = createFileRoute("/")({
  ssr: false,
  loader: async () => {
    const projects = await queryClient.ensureQueryData(projectsQuery);
    await Promise.all(
      projects.map((project) => queryClient.ensureQueryData(projectDetailQuery(project.id))),
    );
  },
  component: HomePage,
});

const ACTIVE = new Set(["starting", "running", "waiting", "idle"]);

/** How each harness launches — mirrors the CLI; the server records either way. */
const HARNESSES = ["claude", "codex", "opencode"] as const;

/**
 * The home screen: EVERYTHING at a glance — what needs you, what runs, and
 * every project with its recent sessions, startable and rejoinable in place.
 * No click-through to see your own work: a session is a continuous piece of
 * work you rejoin, not a run that happened.
 */
function HomePage() {
  const projects = useSuspenseQuery(projectsQuery).data;
  const details = useSuspenseQueries({
    queries: projects.map((project) => projectDetailQuery(project.id)),
  });
  const [progress, setProgress] = useState<Readonly<Record<string, string>>>({});
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);

  const onEvent = useCallback((event: WorkbenchEventDto) => {
    if (event.type === "session-progress" && event.sessionId !== undefined) {
      const sessionId = event.sessionId;
      const line = event.line ?? "";
      setProgress((current) => ({ ...current, [sessionId]: line }));
    }
  }, []);
  useWorkbenchEvents(onEvent);

  const allSessions = details.flatMap((detail, index) =>
    (detail.data?.sessions ?? []).map((session) => ({
      session,
      project: projects[index]?.name ?? "",
    })),
  );
  const waiting = allSessions.filter(({ session }) => session.status === "waiting");
  const live = allSessions.filter(
    ({ session }) => session.status !== "waiting" && ACTIVE.has(session.status),
  );

  /** Fire a fresh session on a project and land in its workbench. */
  const start = (projectId: string, harness: string) => {
    setBusy(`${projectId}:${harness}`);
    void createSession(projectId, harness)
      .then((session) => {
        void launchSession(session.id, [harness])
          .catch(() => undefined)
          .finally(() => {
            void queryClient.invalidateQueries({ queryKey: ["session", session.id] });
          });
        return navigate({ to: "/sessions/$sessionId", params: { sessionId: session.id } });
      })
      .finally(() => setBusy(null));
  };

  /** Rejoin a settled session — same worktree, restored state, fresh workspace. */
  const rejoin = (session: SessionDto) => {
    setBusy(session.id);
    void resumeSession(session.id, null)
      .catch(() => undefined)
      .finally(() => {
        void queryClient.invalidateQueries({ queryKey: ["session", session.id] });
        setBusy(null);
      });
    void navigate({ to: "/sessions/$sessionId", params: { sessionId: session.id } });
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-[1000px]">
        <p className="ev-eyebrow">now</p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-foreground">
          What needs you
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {allSessions.length === 0
            ? "Nothing yet — adopt a repository and start a session."
            : `${waiting.length === 0 ? "Nothing waiting on you" : `${waiting.length} waiting`} · ${live.length} live · ${projects.length} project${projects.length === 1 ? "" : "s"}`}
        </p>

        {waiting.length > 0 && (
          <Section label="Needs you">
            {waiting.map(({ session, project }) => (
              <SessionRow
                key={session.id}
                session={session}
                project={project}
                progressLine={progress[session.id]}
              />
            ))}
          </Section>
        )}

        {live.length > 0 && (
          <Section label="Live">
            {live.map(({ session, project }) => (
              <SessionRow
                key={session.id}
                session={session}
                project={project}
                progressLine={progress[session.id]}
              />
            ))}
          </Section>
        )}

        <section className="mt-10">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-label">Projects</p>
            <Link
              to="/projects"
              className="font-sans text-xs font-medium text-muted-foreground no-underline transition-colors hover:text-foreground"
            >
              Adopt a repository
            </Link>
          </div>
          <div className="mt-3 flex flex-col gap-4">
            {projects.length === 0 ? (
              <div className="rounded-2xl bg-card p-6 shadow-sm">
                <p className="text-sm text-muted-foreground">
                  No projects yet. Adopt one here or run{" "}
                  <span className="font-mono text-xs">mend adopt</span> in a repository.
                </p>
              </div>
            ) : (
              projects.map((project, index) => {
                const sessions = details[index]?.data?.sessions ?? [];
                const recent = sessions.filter(({ status }) => !ACTIVE.has(status)).slice(0, 4);
                return (
                  <div key={project.id} className="rounded-2xl bg-card shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule-faint px-5 py-3.5">
                      <div className="min-w-0">
                        <Link
                          to="/projects/$projectId"
                          params={{ projectId: project.id }}
                          className="font-sans text-sm font-medium text-foreground no-underline hover:text-primary"
                        >
                          {project.name}
                        </Link>
                        <p className="truncate font-mono text-[11px] text-faint">
                          {project.defaultBranch}
                          {project.originUrl === null ? "" : ` · ${project.originUrl}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-label">start:</span>
                        {HARNESSES.map((harness) => (
                          <button
                            key={harness}
                            type="button"
                            disabled={busy !== null}
                            onClick={() => start(project.id, harness)}
                            className="rounded-xl border border-border bg-card px-3 py-1.5 font-mono text-xs text-foreground shadow-xs transition-transform hover:-translate-y-0.5 disabled:opacity-50"
                          >
                            {busy === `${project.id}:${harness}` ? "starting…" : harness}
                          </button>
                        ))}
                      </div>
                    </div>
                    {recent.length === 0 ? (
                      <p className="px-5 py-4 font-mono text-xs text-faint">
                        no settled sessions yet
                      </p>
                    ) : (
                      recent.map((session, sessionIndex) => (
                        <div
                          key={session.id}
                          className={`flex items-center justify-between gap-3 px-5 py-3 ${sessionIndex === 0 ? "" : "border-t border-rule-faint"}`}
                        >
                          <Link
                            to="/sessions/$sessionId"
                            params={{ sessionId: session.id }}
                            className="min-w-0 flex-1 no-underline"
                          >
                            <p className="truncate font-sans text-sm text-foreground">
                              {session.harness}
                              {session.label === null ? "" : ` — ${session.label}`}
                            </p>
                            <p className="mt-0.5 truncate font-mono text-[11px] text-faint">
                              {session.settledAt === null
                                ? session.branch
                                : `settled ${new Date(session.settledAt).toLocaleString()}`}
                            </p>
                          </Link>
                          <SessionStatusDot
                            status={session.status}
                            recorded={session.sealantRunId !== null}
                          />
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => rejoin(session)}
                            className="shrink-0 rounded-xl border border-border bg-card px-3 py-1.5 font-sans text-xs font-medium text-foreground shadow-xs transition-transform hover:-translate-y-0.5 disabled:opacity-50"
                          >
                            {busy === session.id ? "resuming…" : "Resume"}
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>
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

function SessionRow({
  session,
  project,
  progressLine,
}: {
  readonly session: SessionDto;
  readonly project: string;
  readonly progressLine: string | undefined;
}) {
  return (
    <Link
      to="/sessions/$sessionId"
      params={{ sessionId: session.id }}
      className="block rounded-2xl bg-card p-5 no-underline shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-center justify-between gap-4">
        <p className="font-sans text-sm font-medium text-foreground">
          {session.harness} · {project}
          {session.label === null ? "" : ` — ${session.label}`}
        </p>
        <SessionStatusDot status={session.status} recorded={session.sealantRunId !== null} />
      </div>
      <p className="mt-3 truncate font-mono text-xs text-faint">
        {progressLine ?? `${session.branch} · worktree ${session.worktree}`}
      </p>
    </Link>
  );
}

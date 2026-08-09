import { useQuery, useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";

import { AppShell } from "#/components/shell";
import { SessionStatusDot } from "#/components/status";
import {
  createSession,
  launchSession,
  resumeSession,
  stopSession,
  type SessionAnnotationDto,
  type SessionDto,
  type WorkbenchEventDto,
} from "#/lib/api";
import { changeStatsQuery, projectDetailQuery, projectsQuery, queryClient } from "#/lib/queries";
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

interface SessionEntry {
  readonly session: SessionDto;
  readonly project: string;
  readonly annotation: SessionAnnotationDto | undefined;
}

/**
 * The home screen answers plan §6.1's questions in order: what waits on me,
 * what has a delivery pending, which changes nobody reviewed yet, what runs,
 * what settled. Every row carries its review facts (open comments, follow-up)
 * — the DB-cheap annotations; diff stats load lazily per visible change.
 */
function HomePage() {
  const projects = useSuspenseQuery(projectsQuery).data;
  const details = useSuspenseQueries({
    queries: projects.map((project) => projectDetailQuery(project.id)),
  });
  const [progress, setProgress] = useState<Readonly<Record<string, string>>>({});
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const onEvent = useCallback((event: WorkbenchEventDto) => {
    if (event.type === "session-progress" && event.sessionId !== undefined) {
      const sessionId = event.sessionId;
      const line = event.line ?? "";
      setProgress((current) => ({ ...current, [sessionId]: line }));
    }
  }, []);
  useWorkbenchEvents(onEvent);

  const allSessions: ReadonlyArray<SessionEntry> = details.flatMap((detail, index) =>
    (detail.data?.sessions ?? []).map((session) => ({
      session,
      project: projects[index]?.name ?? "",
      annotation: detail.data?.annotations.find((row) => row.sessionId === session.id),
    })),
  );
  const waiting = allSessions.filter(({ session }) => session.status === "waiting");
  const live = allSessions.filter(
    ({ session }) => session.status !== "waiting" && ACTIVE.has(session.status),
  );
  const needsDelivery = allSessions.filter(
    ({ session, annotation }) =>
      !ACTIVE.has(session.status) && annotation?.pendingFollowUp === true,
  );
  // Unreviewed: the session settled with a change nobody has commented on and
  // no follow-up in flight. The diff-stat chip says whether there is anything
  // to read; "no file changes" is an honest answer, not a hidden row.
  const readyToReview = allSessions.filter(
    ({ session, annotation }) =>
      session.status === "completed" &&
      annotation?.changeId != null &&
      annotation.totalComments === 0 &&
      !annotation.pendingFollowUp,
  );

  /** Fire a fresh session on a project and land in its workbench. */
  const start = (projectId: string, harness: string) => {
    const key = `${projectId}:${harness}`;
    setBusy(key);
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

  const toggleSelected = (sessionId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  const stopSelected = () => {
    const ids = live.map(({ session }) => session.id).filter((id) => selected.has(id));
    if (ids.length === 0) return;
    setBusy("stop-selected");
    void Promise.allSettled(ids.map((id) => stopSession(id))).finally(() => {
      setSelected(new Set());
      setBusy(null);
      void queryClient.invalidateQueries();
    });
  };

  const selectedLiveCount = live.filter(({ session }) => selected.has(session.id)).length;

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
            : `${waiting.length === 0 ? "Nothing waiting on you" : `${waiting.length} waiting`} · ${live.length} live · ${readyToReview.length} to review · ${projects.length} project${projects.length === 1 ? "" : "s"}`}
        </p>

        {waiting.length > 0 && (
          <Section label="Needs you">
            {waiting.map((entry) => (
              <SessionCard
                key={entry.session.id}
                entry={entry}
                progressLine={progress[entry.session.id]}
              />
            ))}
          </Section>
        )}

        {needsDelivery.length > 0 && (
          <Section label="Needs delivery">
            {needsDelivery.map((entry) => (
              <SessionCard key={entry.session.id} entry={entry} progressLine={undefined} />
            ))}
          </Section>
        )}

        {readyToReview.length > 0 && (
          <Section label="Ready to review">
            {readyToReview.map(({ session, project, annotation }) => (
              <ReviewRow
                key={session.id}
                session={session}
                project={project}
                changeId={annotation?.changeId ?? ""}
              />
            ))}
          </Section>
        )}

        {live.length > 0 && (
          <Section
            label="Live"
            action={
              selectedLiveCount > 0 ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={stopSelected}
                  className="rounded-xl border border-border bg-card px-3 py-1 font-sans text-xs font-medium text-foreground shadow-xs disabled:opacity-50"
                >
                  {busy === "stop-selected" ? "Stopping…" : `Stop ${selectedLiveCount} selected`}
                </button>
              ) : null
            }
          >
            {live.map((entry) => (
              <div key={entry.session.id} className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(entry.session.id)}
                  onChange={() => toggleSelected(entry.session.id)}
                  aria-label={`select ${entry.session.harness} session`}
                  className="mt-6 size-3.5 shrink-0 accent-[var(--sw-accent)]"
                />
                <div className="min-w-0 flex-1">
                  <SessionCard entry={entry} progressLine={progress[entry.session.id]} />
                </div>
              </div>
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
                const detail = details[index]?.data;
                const sessions = detail?.sessions ?? [];
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
                        {HARNESSES.map((harness) => {
                          const key = `${project.id}:${harness}`;
                          return (
                            <button
                              key={harness}
                              type="button"
                              disabled={busy === key}
                              onClick={() => start(project.id, harness)}
                              className="rounded-xl border border-border bg-card px-3 py-1.5 font-mono text-xs text-foreground shadow-xs transition-transform hover:-translate-y-0.5 disabled:opacity-50"
                            >
                              {busy === key ? "starting…" : harness}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {recent.length === 0 ? (
                      <p className="px-5 py-4 font-mono text-xs text-faint">
                        no settled sessions yet
                      </p>
                    ) : (
                      recent.map((session, sessionIndex) => {
                        const annotation = detail?.annotations.find(
                          (row) => row.sessionId === session.id,
                        );
                        return (
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
                                <AnnotationSuffix annotation={annotation} />
                              </p>
                            </Link>
                            <SessionStatusDot
                              status={session.status}
                              recorded={session.sealantRunId !== null}
                            />
                            {annotation?.changeId != null && (
                              <Link
                                to="/changes/$changeId"
                                params={{ changeId: annotation.changeId }}
                                className="shrink-0 font-sans text-xs font-medium text-muted-foreground no-underline transition-colors hover:text-foreground"
                              >
                                Review
                              </Link>
                            )}
                            <button
                              type="button"
                              disabled={busy === session.id}
                              onClick={() => rejoin(session)}
                              className="shrink-0 rounded-xl border border-border bg-card px-3 py-1.5 font-sans text-xs font-medium text-foreground shadow-xs transition-transform hover:-translate-y-0.5 disabled:opacity-50"
                            >
                              {busy === session.id ? "resuming…" : "Resume"}
                            </button>
                          </div>
                        );
                      })
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
  action,
  children,
}: {
  readonly label: string;
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="mt-9">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-label">{label}</p>
        {action}
      </div>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

/** The review facts appended to a row's mono line — silent when there is nothing to say. */
function AnnotationSuffix({
  annotation,
}: {
  readonly annotation: SessionAnnotationDto | undefined;
}) {
  if (annotation === undefined) return null;
  return (
    <>
      {annotation.openComments > 0 && (
        <span className="text-ink-2">
          {" "}
          · {annotation.openComments} open comment{annotation.openComments === 1 ? "" : "s"}
        </span>
      )}
      {annotation.pendingFollowUp && <span className="text-warning"> · follow-up pending</span>}
    </>
  );
}

/** Lazy diff stats for one change — one cached git spawn per visible row. */
function ChangeStatsChip({ changeId }: { readonly changeId: string }) {
  const stats = useQuery(changeStatsQuery(changeId));
  if (stats.data === undefined) return null;
  if (stats.data.files === 0) {
    return <span className="text-faint"> · no file changes</span>;
  }
  return (
    <span className="text-ink-2">
      {" "}
      · {stats.data.files} file{stats.data.files === 1 ? "" : "s"} · +{stats.data.additions} −
      {stats.data.deletions}
    </span>
  );
}

function SessionCard({
  entry,
  progressLine,
}: {
  readonly entry: SessionEntry;
  readonly progressLine: string | undefined;
}) {
  const { session, project, annotation } = entry;
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
        <AnnotationSuffix annotation={annotation} />
      </p>
    </Link>
  );
}

/** An unreviewed change: straight to the review, stats up front. */
function ReviewRow({
  session,
  project,
  changeId,
}: {
  readonly session: SessionDto;
  readonly project: string;
  readonly changeId: string;
}) {
  return (
    <Link
      to="/changes/$changeId"
      params={{ changeId }}
      className="block rounded-2xl bg-card p-5 no-underline shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-center justify-between gap-4">
        <p className="font-sans text-sm font-medium text-foreground">
          {session.harness} · {project}
          {session.label === null ? "" : ` — ${session.label}`}
        </p>
        <span className="font-sans text-xs font-medium text-primary">Review →</span>
      </div>
      <p className="mt-3 truncate font-mono text-xs text-faint">
        {session.settledAt === null
          ? session.branch
          : `settled ${new Date(session.settledAt).toLocaleString()}`}
        <ChangeStatsChip changeId={changeId} />
      </p>
    </Link>
  );
}

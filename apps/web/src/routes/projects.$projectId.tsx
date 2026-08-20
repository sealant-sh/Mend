import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { useContextMenu } from "#/components/context-menu";
import { ProjectSetupFacts } from "#/components/project-setup-facts";
import { AppShell } from "#/components/shell";
import { SessionStatusDot } from "#/components/status";
import { removeSession } from "#/lib/api";
import {
  projectDetailQuery,
  projectMountsQuery,
  projectRecipesQuery,
  projectReferencesQuery,
  queryClient,
  referencesQuery,
} from "#/lib/queries";
import { useWorkbenchEvents } from "#/lib/workbench-events";
import {
  HARNESSES,
  LIVE_STATES,
  sessionMenu,
  startSession,
  type Harness,
} from "#/lib/workbench-menus";

export const Route = createFileRoute("/projects/$projectId")({
  ssr: false,
  loader: async ({ params }) => {
    await Promise.all([
      queryClient.ensureQueryData(projectDetailQuery(params.projectId)),
      queryClient.ensureQueryData(referencesQuery),
      queryClient.ensureQueryData(projectReferencesQuery(params.projectId)),
      queryClient.ensureQueryData(projectMountsQuery(params.projectId)),
      queryClient.ensureQueryData(projectRecipesQuery(params.projectId)),
    ]);
  },
  component: ProjectPage,
});

function ProjectPage() {
  const { projectId } = Route.useParams();
  const { project, sessions, annotations } = useSuspenseQuery(projectDetailQuery(projectId)).data;
  const navigate = useNavigate();
  const [harness, setHarness] = useState<Harness>("claude");
  const [starting, setStarting] = useState(false);
  const [clearing, setClearing] = useState<"idle" | "armed" | "working">("idle");
  const { openMenu, menuElement } = useContextMenu();
  useWorkbenchEvents();

  const live = sessions.filter((session) => LIVE_STATES.has(session.status));
  const settled = sessions.filter((session) => !LIVE_STATES.has(session.status));
  const ordered = [...live, ...settled];

  /** Second click executes — destructive actions confirm explicitly (plan §15). */
  const clearSettled = () => {
    if (clearing === "idle") {
      setClearing("armed");
      return;
    }
    if (clearing !== "armed") return;
    setClearing("working");
    void Promise.allSettled(settled.map((session) => removeSession(session.id))).finally(() => {
      setClearing("idle");
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    });
  };

  const start = () => {
    setStarting(true);
    void startSession(navigate, projectId, harness).finally(() => setStarting(false));
  };

  return (
    <AppShell projectId={projectId}>
      <div className="mx-auto max-w-[1100px]">
        <p className="ev-eyebrow">project</p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-foreground">
          {project.name}
        </h1>
        <p className="mt-2 font-mono text-xs text-faint">
          store {project.storePath} · {project.defaultBranch}
          {project.adoptedSha === null ? "" : `@${project.adoptedSha.slice(0, 7)}`}
          {project.originUrl === null ? "" : ` · origin ${project.originUrl}`}
        </p>

        <div className="mt-8 grid gap-12 border-t border-rule pt-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section>
            <p className="border-b border-rule pb-3 text-xs font-medium text-label">Sessions</p>
            <div className="mt-4 overflow-hidden rounded-2xl border border-rule bg-card shadow-xs">
              {ordered.length === 0 ? (
                <p className="p-5 text-sm text-muted-foreground">
                  No sessions yet — start one on the right, or{" "}
                  <span className="font-mono text-xs">mend claude</span> in this repository. Either
                  way it runs in its own worktree, recorded.
                </p>
              ) : (
                ordered.map((session, index) => {
                  const annotation = annotations.find((row) => row.sessionId === session.id);
                  return (
                    <div
                      key={session.id}
                      onContextMenu={(event) =>
                        openMenu(event, sessionMenu(session, annotation, navigate))
                      }
                      className={`flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-secondary ${index === 0 ? "" : "border-t border-rule-faint"}`}
                    >
                      <Link
                        to="/sessions/$sessionId"
                        params={{ sessionId: session.id }}
                        className="min-w-0 flex-1 no-underline"
                      >
                        <p className="font-sans text-sm font-medium text-foreground">
                          {session.harness}
                          {session.label === null ? "" : ` — ${session.label}`}
                        </p>
                        <p className="mt-1 truncate font-mono text-xs text-faint">
                          {session.branch} · base {session.baseSha.slice(0, 12)}
                          {annotation !== undefined && annotation.openComments > 0 && (
                            <span className="text-ink-2">
                              {" "}
                              · {annotation.openComments} open comment
                              {annotation.openComments === 1 ? "" : "s"}
                            </span>
                          )}
                          {annotation?.pendingFollowUp === true && (
                            <span className="text-warning"> · follow-up pending</span>
                          )}
                        </p>
                      </Link>
                      {annotation?.changeId != null && (
                        <Link
                          to="/changes/$changeId"
                          params={{ changeId: annotation.changeId }}
                          className="shrink-0 font-sans text-xs font-medium text-muted-foreground no-underline transition-colors hover:text-foreground"
                        >
                          Review
                        </Link>
                      )}
                      <SessionStatusDot
                        status={session.status}
                        recorded={session.sealantRunId !== null}
                      />
                    </div>
                  );
                })
              )}
            </div>
            {settled.length > 0 && (
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  disabled={clearing === "working"}
                  onClick={clearSettled}
                  onBlur={() => setClearing((current) => (current === "armed" ? "idle" : current))}
                  className={`font-sans text-xs font-medium transition-colors ${clearing === "armed" ? "text-warning" : "text-muted-foreground hover:text-foreground"} disabled:opacity-50`}
                >
                  {clearing === "working"
                    ? "Clearing…"
                    : clearing === "armed"
                      ? `Really delete ${settled.length} settled session${settled.length === 1 ? "" : "s"}?`
                      : "Clear settled"}
                </button>
              </div>
            )}
          </section>

          <aside className="flex flex-col gap-6">
            <section className="rounded-2xl bg-panel p-5 shadow-[var(--shadow-sm)]">
              <p className="font-sans text-sm font-medium text-foreground">Start a session</p>
              <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Harness">
                {HARNESSES.map((choice) => {
                  const selected = choice === harness;
                  return (
                    <button
                      key={choice}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setHarness(choice)}
                      className={`rounded-xl border px-3 py-1.5 font-mono text-xs transition-colors ${
                        selected
                          ? "border-info/50 bg-wash text-info"
                          : "border-border bg-card text-foreground hover:bg-secondary"
                      }`}
                    >
                      {choice}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                disabled={starting}
                onClick={start}
                className="mt-4 w-full rounded-xl bg-primary px-4 py-2.5 font-sans text-sm font-medium text-primary-foreground shadow-[var(--shadow-cobalt)] transition-transform hover:-translate-y-0.5 disabled:opacity-50"
              >
                {starting ? "Starting…" : "Start in a new worktree"}
              </button>
              <p className="mt-3 font-mono text-[11.5px] text-faint">
                {harness === "shell"
                  ? "a bash in its own worktree · recorded"
                  : `mend ${harness} · new worktree · recorded`}
              </p>
            </section>
            <ProjectSetupFacts projectId={projectId} />
          </aside>
        </div>
      </div>
      {menuElement}
    </AppShell>
  );
}

import { useContextMenu } from "@mend/ui/context-menu";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { ProjectSetupFacts } from "#/components/project-setup-facts";
import { SessionComposer } from "#/components/session-composer";
import { AppShell } from "#/components/shell";
import { SessionStatusDot } from "#/components/status";
import { removeSession } from "#/lib/api";
import { useTRPC } from "#/lib/trpc";
import { useWorkbenchEvents } from "#/lib/workbench-events";
import { LIVE_STATES, sessionMenu, startSession } from "#/lib/workbench-menus";

export const Route = createFileRoute("/projects/$projectId")({
  ssr: false,
  loader: async ({ context: { queryClient, trpc }, params }) => {
    await Promise.all([
      queryClient.ensureQueryData(trpc.projects.detail.queryOptions({ id: params.projectId })),
      queryClient.ensureQueryData(trpc.git.references.queryOptions()),
      queryClient.ensureQueryData(trpc.projects.references.queryOptions({ id: params.projectId })),
      queryClient.ensureQueryData(trpc.projects.mounts.queryOptions({ id: params.projectId })),
      queryClient.ensureQueryData(trpc.projects.recipes.queryOptions({ id: params.projectId })),
    ]);
  },
  component: ProjectPage,
});

function ProjectPage() {
  const { projectId } = Route.useParams();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const launchContext = { queryClient, trpc };
  const { project, sessions, annotations } = useSuspenseQuery(
    trpc.projects.detail.queryOptions({ id: projectId }),
  ).data;
  const navigate = useNavigate();
  const [shellStarting, setShellStarting] = useState(false);
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
      void queryClient.invalidateQueries(trpc.projects.pathFilter());
      void queryClient.invalidateQueries(trpc.environment.pathFilter());
    });
  };

  return (
    <AppShell projectId={projectId}>
      <div className="mx-auto max-w-[1100px]">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="ev-eyebrow">project</p>
            <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-foreground">
              {project.name}
            </h1>
            <p className="mt-2 font-mono text-xs text-faint">
              store {project.storePath} · {project.defaultBranch}
              {project.adoptedSha === null ? "" : `@${project.adoptedSha.slice(0, 7)}`}
              {project.originUrl === null ? "" : ` · origin ${project.originUrl}`}
            </p>
          </div>
          <button
            type="button"
            disabled={shellStarting}
            onClick={() => {
              setShellStarting(true);
              void startSession(navigate, launchContext, projectId, "shell").finally(() =>
                setShellStarting(false),
              );
            }}
            className="mt-1 shrink-0 rounded-xl border border-border bg-card px-3.5 py-2 font-sans text-[13px] font-medium text-foreground shadow-xs transition-transform hover:-translate-y-0.5 disabled:opacity-50"
          >
            {shellStarting ? "Starting…" : "Open a shell"}
          </button>
        </div>

        <div className="mt-6">
          <SessionComposer projects={[project]} fixedProjectId={project.id} />
          <p className="mt-2 font-mono text-[11.5px] text-faint">new worktree · recorded</p>
        </div>

        <div className="mt-8 grid gap-12 border-t border-rule pt-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section>
            <p className="border-b border-rule pb-3 text-xs font-medium text-label">Sessions</p>
            <div className="mt-4 overflow-hidden rounded-2xl border border-rule bg-card shadow-xs">
              {ordered.length === 0 ? (
                <p className="p-5 text-sm text-muted-foreground">
                  No sessions yet — start one above, or{" "}
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
                        openMenu(event, sessionMenu(session, annotation, navigate, launchContext))
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
            <ProjectSetupFacts projectId={projectId} />
          </aside>
        </div>
      </div>
      {menuElement}
    </AppShell>
  );
}

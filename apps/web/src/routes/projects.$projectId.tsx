import { useContextMenu } from "@mend/ui/context-menu";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { ProjectSetupFacts } from "#/components/project-setup-facts";
import { SessionComposer } from "#/components/session-composer";
import { AppShell } from "#/components/shell";
import { SessionStatusDot } from "#/components/status";
import { removeWorktree } from "#/lib/api";
import { useTRPC } from "#/lib/trpc";
import { useWorkbenchEvents } from "#/lib/workbench-events";
import {
  LIVE_STATES,
  sessionMenu,
  startSession,
  worktreeDisplayName,
  worktreeMenu,
} from "#/lib/workbench-menus";

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
  const { project, sessions, annotations, worktrees, worktreeAnnotations } = useSuspenseQuery(
    trpc.projects.detail.queryOptions({ id: projectId }),
  ).data;
  const navigate = useNavigate();
  const [shellStarting, setShellStarting] = useState(false);
  const [clearing, setClearing] = useState<"idle" | "armed" | "working">("idle");
  const { openMenu, menuElement } = useContextMenu();
  useWorkbenchEvents();

  // The container tier: sessions grouped under their worktree, live/settled
  // split at the WORKTREE level (live = any conversation live).
  const groups = worktrees.map((worktree) => {
    const members = sessions.filter((session) => session.worktreeId === worktree.id);
    return {
      worktree,
      members,
      annotation: worktreeAnnotations.find((row) => row.worktreeId === worktree.id),
      live: members.filter((session) => LIVE_STATES.has(session.status)).length,
      newest: members[0] ?? null,
    };
  });
  const ordered = groups.toSorted((a, b) => {
    if (a.live > 0 !== b.live > 0) return a.live > 0 ? -1 : 1;
    const aAt = a.newest?.createdAt ?? a.worktree.createdAt;
    const bAt = b.newest?.createdAt ?? b.worktree.createdAt;
    return bAt.getTime() - aAt.getTime();
  });
  const settledGroups = ordered.filter((group) => group.live === 0);

  /** Second click executes — destructive actions confirm explicitly (plan §15). */
  const clearSettled = () => {
    if (clearing === "idle") {
      setClearing("armed");
      return;
    }
    if (clearing !== "armed") return;
    setClearing("working");
    // Sequential, not parallel: each removal walks the store's worktree list.
    void settledGroups
      .reduce(
        (chain, group) => chain.then(() => removeWorktree(group.worktree.id).catch(() => null)),
        Promise.resolve<unknown>(null),
      )
      .finally(() => {
        setClearing("idle");
        void queryClient.invalidateQueries(trpc.projects.pathFilter());
        void queryClient.invalidateQueries(trpc.worktrees.pathFilter());
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
            <p className="border-b border-rule pb-3 text-xs font-medium text-label">Worktrees</p>
            <div className="mt-4 overflow-hidden rounded-2xl border border-rule bg-card shadow-xs">
              {ordered.length === 0 ? (
                <p className="p-5 text-sm text-muted-foreground">
                  No worktrees yet — start a session above, or{" "}
                  <span className="font-mono text-xs">mend claude</span> in this repository. Either
                  way it runs in its own worktree, recorded.
                </p>
              ) : (
                ordered.map((group, index) => {
                  const { worktree, members, annotation } = group;
                  const name = worktreeDisplayName(worktree, members);
                  return (
                    <div
                      key={worktree.id}
                      className={index === 0 ? "" : "border-t border-rule-faint"}
                    >
                      <div
                        onContextMenu={(event) =>
                          openMenu(
                            event,
                            worktreeMenu(worktree, members, annotation, navigate, launchContext),
                          )
                        }
                        className="flex items-center justify-between gap-4 px-5 pt-4 pb-1"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-sans text-sm font-medium text-foreground">{name}</p>
                          <p className="mt-1 truncate font-mono text-xs text-faint">
                            {worktree.branch} · base{" "}
                            {worktree.baseRef ?? worktree.baseSha.slice(0, 12)}
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
                        </div>
                        {annotation?.changeId != null && (
                          <Link
                            to="/changes/$changeId"
                            params={{ changeId: annotation.changeId }}
                            className="shrink-0 font-sans text-xs font-medium text-muted-foreground no-underline transition-colors hover:text-foreground"
                          >
                            Review
                          </Link>
                        )}
                      </div>
                      {members.length === 0 ? (
                        <p className="px-5 pt-1 pb-4 font-mono text-xs text-faint">
                          no sessions yet
                        </p>
                      ) : (
                        members.map((session) => {
                          const sessionAnnotation = annotations.find(
                            (row) => row.sessionId === session.id,
                          );
                          return (
                            <div
                              key={session.id}
                              onContextMenu={(event) =>
                                openMenu(
                                  event,
                                  sessionMenu(session, sessionAnnotation, navigate, launchContext),
                                )
                              }
                              className="flex items-center justify-between gap-4 py-2 pr-5 pl-9 transition-colors last:pb-4 hover:bg-secondary"
                            >
                              <Link
                                to="/sessions/$sessionId"
                                params={{ sessionId: session.id }}
                                className="min-w-0 flex-1 no-underline"
                              >
                                <p className="truncate font-sans text-[13px] text-foreground">
                                  {session.harness}
                                  {session.label === null ? "" : ` — ${session.label}`}
                                </p>
                              </Link>
                              <SessionStatusDot
                                status={session.status}
                                recorded={session.sealantRunId !== null}
                              />
                            </div>
                          );
                        })
                      )}
                    </div>
                  );
                })
              )}
            </div>
            {settledGroups.length > 0 && (
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
                      ? `Really remove ${settledGroups.length} settled worktree${settledGroups.length === 1 ? "" : "s"}? Sessions and changes go with them.`
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

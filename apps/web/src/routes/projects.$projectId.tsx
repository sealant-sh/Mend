import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { AppShell } from "#/components/shell";
import { SessionStatusDot } from "#/components/status";
import { projectDetailQuery, queryClient } from "#/lib/queries";
import { useWorkbenchEvents } from "#/lib/workbench-events";

export const Route = createFileRoute("/projects/$projectId")({
  ssr: false,
  loader: async ({ params }) => {
    await queryClient.ensureQueryData(projectDetailQuery(params.projectId));
  },
  component: ProjectPage,
});

function ProjectPage() {
  const { projectId } = Route.useParams();
  const { project, sessions } = useSuspenseQuery(projectDetailQuery(projectId)).data;
  useWorkbenchEvents();

  return (
    <AppShell>
      <div className="mx-auto max-w-[900px]">
        <p className="ev-eyebrow">project</p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-foreground">
          {project.name}
        </h1>
        <p className="mt-2 font-mono text-xs text-faint">
          store {project.storePath} · {project.defaultBranch}
          {project.adoptedSha === null ? "" : `@${project.adoptedSha.slice(0, 7)}`}
          {project.originUrl === null ? "" : ` · origin ${project.originUrl}`}
        </p>

        <section className="mt-9">
          <p className="text-xs font-medium text-label">Sessions</p>
          <div className="mt-3 overflow-hidden rounded-2xl bg-card shadow-sm">
            {sessions.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">
                No sessions yet — <span className="font-mono text-xs">mend codex</span> in this
                repository starts one, in its own worktree.
              </p>
            ) : (
              sessions.map((session, index) => (
                <Link
                  key={session.id}
                  to="/sessions/$sessionId"
                  params={{ sessionId: session.id }}
                  className={`flex items-center justify-between gap-4 px-5 py-4 no-underline transition-colors hover:bg-secondary ${index === 0 ? "" : "border-t border-rule-faint"}`}
                >
                  <div className="min-w-0">
                    <p className="font-sans text-sm font-medium text-foreground">
                      {session.harness}
                      {session.label === null ? "" : ` — ${session.label}`}
                    </p>
                    <p className="mt-1 truncate font-mono text-xs text-faint">
                      {session.branch} · base {session.baseSha.slice(0, 12)}
                    </p>
                  </div>
                  <SessionStatusDot
                    status={session.status}
                    recorded={session.sealantRunId !== null}
                  />
                </Link>
              ))
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

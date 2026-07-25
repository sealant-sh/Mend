import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { AppShell } from "#/components/shell";
import { SessionStatusDot } from "#/components/status";
import { createSession, launchSession } from "#/lib/api";
import { projectDetailQuery, queryClient } from "#/lib/queries";
import { useWorkbenchEvents } from "#/lib/workbench-events";

export const Route = createFileRoute("/projects/$projectId")({
  ssr: false,
  loader: async ({ params }) => {
    await queryClient.ensureQueryData(projectDetailQuery(params.projectId));
  },
  component: ProjectPage,
});

/** How each harness launches — mirrors the CLI's map; the server records either way. */
const HARNESSES: ReadonlyArray<{ readonly name: string; readonly argv: ReadonlyArray<string> }> = [
  { name: "claude", argv: ["claude"] },
  { name: "codex", argv: ["codex"] },
  { name: "opencode", argv: ["opencode"] },
];

function ProjectPage() {
  const { projectId } = Route.useParams();
  const { project, sessions } = useSuspenseQuery(projectDetailQuery(projectId)).data;
  const navigate = useNavigate();
  const [starting, setStarting] = useState<string | null>(null);
  useWorkbenchEvents();

  /**
   * Fire a session from here: create the row, kick the supervised launch, and
   * go straight to the session page — its terminal pane attaches the moment
   * the workspace is ready. The launch promise outlives the navigation (same
   * SPA); a failure settles the session server-side, so the page shows it.
   */
  const start = (harness: string, argv: ReadonlyArray<string>) => {
    setStarting(harness);
    void createSession(projectId, harness)
      .then((session) => {
        void launchSession(session.id, argv)
          .catch(() => undefined)
          .finally(() => {
            void queryClient.invalidateQueries({ queryKey: ["session", session.id] });
          });
        return navigate({ to: "/sessions/$sessionId", params: { sessionId: session.id } });
      })
      .finally(() => setStarting(null));
  };

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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-medium text-label">Sessions</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-label">start a session:</span>
              {HARNESSES.map((harness) => (
                <button
                  key={harness.name}
                  type="button"
                  disabled={starting !== null}
                  onClick={() => start(harness.name, harness.argv)}
                  className="rounded-xl border border-border bg-card px-3 py-1.5 font-mono text-xs text-foreground shadow-xs transition-transform hover:-translate-y-0.5 disabled:opacity-50"
                >
                  {starting === harness.name ? "starting…" : harness.name}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 overflow-hidden rounded-2xl bg-card shadow-sm">
            {sessions.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">
                No sessions yet — start one above, or{" "}
                <span className="font-mono text-xs">mend claude</span> in this repository. Either
                way it runs in its own worktree, recorded.
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

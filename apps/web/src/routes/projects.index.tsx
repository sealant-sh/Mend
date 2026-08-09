import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { useContextMenu } from "#/components/context-menu";
import { AppShell } from "#/components/shell";
import { adoptProject } from "#/lib/api";
import { projectsQuery, queryClient } from "#/lib/queries";
import { useWorkbenchEvents } from "#/lib/workbench-events";
import { projectMenu } from "#/lib/workbench-menus";

export const Route = createFileRoute("/projects/")({
  ssr: false,
  loader: async () => {
    await queryClient.ensureQueryData(projectsQuery);
  },
  component: ProjectsPage,
});

function ProjectsPage() {
  const projects = useSuspenseQuery(projectsQuery).data;
  const navigate = useNavigate();
  const { openMenu, menuElement } = useContextMenu();
  useWorkbenchEvents();

  return (
    <AppShell>
      <div className="mx-auto max-w-[760px]">
        <p className="ev-eyebrow">projects</p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-foreground">
          Adopted repositories
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A project is a repository cloned into Mend&apos;s store; sessions get their own worktree.
        </p>

        <AdoptForm />

        <div className="mt-8 flex flex-col gap-3">
          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing adopted yet — use the form above, or{" "}
              <span className="font-mono text-xs">mend adopt</span> from a repository.
            </p>
          ) : (
            projects.map((project) => (
              <Link
                key={project.id}
                to="/projects/$projectId"
                params={{ projectId: project.id }}
                onContextMenu={(event) => openMenu(event, projectMenu(project, navigate))}
                className="rounded-2xl bg-card p-5 no-underline shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-center justify-between gap-4">
                  <p className="font-sans text-sm font-medium text-foreground">{project.name}</p>
                  <p className="font-mono text-xs text-faint">{project.defaultBranch}</p>
                </div>
                <p className="mt-2 truncate font-mono text-xs text-faint">
                  {project.originUrl ?? project.storePath}
                </p>
              </Link>
            ))
          )}
        </div>
      </div>
      {menuElement}
    </AppShell>
  );
}

function AdoptForm() {
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    if (source === "") return;
    setPending(true);
    setError(null);
    try {
      await adoptProject(name === "" ? inferName(source) : name, source);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      setName("");
      setSource("");
    } catch (adoptError) {
      setError(adoptError instanceof Error ? adoptError.message : String(adoptError));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mt-7 rounded-2xl bg-card p-5 shadow-sm">
      <p className="text-xs font-medium text-label">Adopt a repository</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          value={source}
          onChange={(event) => setSource(event.target.value)}
          placeholder="URL or absolute path on this machine"
          className="min-w-64 flex-1 rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-faint"
        />
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="name (optional)"
          className="w-40 rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-faint"
        />
        <button
          type="button"
          disabled={pending || source === ""}
          onClick={() => void submit()}
          className="rounded-xl bg-primary px-4 py-2 font-sans text-sm font-medium text-primary-foreground shadow-[var(--shadow-cobalt)] transition-opacity disabled:opacity-50"
        >
          {pending ? "Adopting…" : "Adopt"}
        </button>
      </div>
      {error !== null && <p className="mt-3 font-mono text-xs text-danger">{error}</p>}
      <p className="mt-3 text-xs text-muted-foreground">
        Cloned into the store; your existing checkout is never the execution target.
      </p>
    </div>
  );
}

const inferName = (source: string) => {
  const trimmed = source.replace(/\/+$/, "").replace(/\.git$/, "");
  return trimmed.split("/").at(-1) ?? trimmed;
};

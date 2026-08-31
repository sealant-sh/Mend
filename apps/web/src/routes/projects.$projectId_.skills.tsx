import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { ProjectCrumbs } from "#/components/breadcrumb";
import { AppShell } from "#/components/shell";
import { SkillsLibrary } from "#/components/skills-library";
import { useTRPC } from "#/lib/trpc";
import { useWorkbenchEvents } from "#/lib/workbench-events";

export const Route = createFileRoute("/projects/$projectId_/skills")({
  ssr: false,
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(
      context.trpc.skills.forProject.queryOptions({ id: params.projectId }),
    );
  },
  component: ProjectSkillsPage,
});

function ProjectSkillsPage() {
  const { projectId } = Route.useParams();
  const trpc = useTRPC();
  const projects = useQuery(trpc.projects.list.queryOptions());
  const name = (projects.data ?? []).find((project) => project.id === projectId)?.name;
  useWorkbenchEvents();

  return (
    <AppShell projectId={projectId}>
      <div className="mx-auto max-w-[760px]">
        <ProjectCrumbs projectId={projectId} leaf="skills" />
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-foreground">
          Project skills
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Instruction bundles every session in {name ?? "this project"} receives; a same-named
          project skill overrides a personal one.
        </p>
        <SkillsLibrary scope="project" projectId={projectId} />
      </div>
    </AppShell>
  );
}

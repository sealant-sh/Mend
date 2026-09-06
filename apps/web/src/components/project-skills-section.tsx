import { Switch } from "@mend/ui/components/ui/switch";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { SkillsLibrary } from "#/components/skills-library";
import { setProjectInheritUserSkills, type ProjectDto } from "#/lib/api";
import { useTRPC } from "#/lib/trpc";

/** Project skills stay in setup; global inheritance is independent of the disclosure. */
export function ProjectSkillsSection({ project }: { readonly project: ProjectDto }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const hash = useLocation({ select: (location) => location.hash });
  const [expanded, setExpanded] = useState(hash === "skills");
  const globals = useSuspenseQuery(trpc.skills.list.queryOptions()).data;
  const locals = useSuspenseQuery(trpc.skills.forProject.queryOptions({ id: project.id })).data;
  const projectNames = new Set(locals.map((skill) => skill.name));
  const inherits = project.inheritUserSkills !== false;
  const inheritance = useMutation({
    mutationFn: (enabled: boolean) => setProjectInheritUserSkills(project.id, enabled),
    onSuccess: () => queryClient.invalidateQueries(trpc.projects.pathFilter()),
  });

  return (
    <section id="skills" aria-labelledby="project-skills-heading" className="project-setup-card">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="project-skills-content"
          onClick={() => setExpanded((open) => !open)}
          className="flex min-w-0 items-center gap-2.5 rounded-sm text-left"
        >
          <ChevronRight
            aria-hidden="true"
            className={`size-4 shrink-0 text-faint transition-transform ${expanded ? "rotate-90" : ""}`}
          />
          <span>
            <span id="project-skills-heading" className="block font-sans text-sm font-semibold">
              Skills
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {inherits ? "Inherits your global skills" : "Global skills off"}
              {locals.length > 0
                ? ` · ${locals.length} project skill${locals.length === 1 ? "" : "s"}`
                : ""}
            </span>
          </span>
        </button>
        <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
          <label htmlFor="inherit-global-skills">Use global skills</label>
          <Switch
            id="inherit-global-skills"
            checked={inherits}
            disabled={inheritance.isPending}
            onCheckedChange={(enabled) => inheritance.mutate(enabled)}
          />
          <span aria-hidden="true" className="w-6 text-foreground">
            {inherits ? "On" : "Off"}
          </span>
        </div>
      </div>
      {inheritance.error !== null && (
        <p role="alert" className="mt-3 text-xs text-danger">
          {inheritance.error.message}
        </p>
      )}
      <div
        id="project-skills-content"
        hidden={!expanded}
        className="mt-5 border-t border-rule pt-5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="text-sm font-medium">Global skills</h3>
          <Link to="/skills" className="text-xs font-medium text-info no-underline hover:underline">
            Manage global skills →
          </Link>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {inherits
            ? "Included in new sessions. A same-named project skill replaces the global one."
            : "Excluded from new sessions. Project skills below still apply."}{" "}
          Running sessions keep the skills they started with.
        </p>
        {globals.length === 0 ? (
          <p className="mt-4 text-xs text-faint">Your global library is empty.</p>
        ) : (
          <ul className="mt-4 divide-y divide-rule-faint">
            {globals.map((skill) => (
              <li key={skill.id} className="flex items-center justify-between gap-4 py-3 text-xs">
                <Link
                  to="/skills/$skillId"
                  params={{ skillId: skill.id }}
                  className="min-w-0 font-mono text-foreground no-underline break-all hover:underline"
                >
                  {skill.name}
                </Link>
                <span className="shrink-0 text-faint">
                  {inherits
                    ? projectNames.has(skill.name)
                      ? "Overridden here"
                      : "Inherited"
                    : "Off"}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-6 border-t border-rule pt-5">
          <h3 className="text-sm font-medium">Project skills</h3>
          <p className="mt-2 text-xs text-muted-foreground">
            Instructions for sessions in {project.name}, without changing your global library.
          </p>
          <SkillsLibrary scope="project" projectId={project.id} />
        </div>
      </div>
    </section>
  );
}

import { StatusDot } from "#/components/status-dot";
import type { SessionDto } from "#/lib/api";
import type { TreeProject } from "#/lib/model";
import { sessionTitle, statusTone } from "#/lib/words";

/**
 * The tree (herdr's "spaces", relabeled per BRIEF.md): projects from the
 * store, agent sessions nested beneath — every session is a branch worktree,
 * which is exactly what herdr's space tree showed. Selecting a project
 * focuses its tabs; selecting a session opens/raises its tab.
 */
export function ProjectTree({
  tree,
  focusedProjectId,
  focusedSessionId,
  onFocusProject,
  onOpenSession,
  onLaunch,
}: {
  readonly tree: ReadonlyArray<TreeProject>;
  readonly focusedProjectId: string | null;
  readonly focusedSessionId: string | null;
  readonly onFocusProject: (id: string) => void;
  readonly onOpenSession: (projectId: string, sessionId: string) => void;
  readonly onLaunch: (projectId: string) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
      <p className="px-4 pt-1 pb-1.5 font-mono text-[11.5px] tracking-[0.6px] text-muted-foreground uppercase">
        projects
      </p>
      {tree.length === 0 && (
        <p className="px-4 py-1 font-sans text-[12.5px] leading-relaxed text-label">
          no projects — adopt one with <span className="text-foreground">mend adopt</span>
        </p>
      )}
      {tree.map(({ project, sessions }) => {
        const projectFocused = project.id === focusedProjectId;
        return (
          <section key={project.id} className="group/project">
            <div
              className={`flex items-center gap-1.5 pr-2 transition-colors hover:bg-[var(--sw-sunken)] ${
                projectFocused && focusedSessionId === null ? "bg-wash" : ""
              }`}
            >
              <button
                type="button"
                onClick={() => onFocusProject(project.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5 py-[5px] pl-4 text-left"
              >
                <span
                  aria-hidden="true"
                  className={`size-[7px] shrink-0 rounded-full ${
                    projectFocused
                      ? "bg-[var(--sw-accent)]"
                      : "border-[1.5px] border-faint bg-transparent"
                  }`}
                />
                <span className="truncate font-sans text-[14px] font-medium text-foreground">
                  {project.name}
                </span>
                <span className="truncate font-mono text-[11.5px] text-faint">
                  {project.defaultBranch}
                </span>
              </button>
              <button
                type="button"
                title="New session in this project"
                aria-label={`New session in ${project.name}`}
                onClick={() => onLaunch(project.id)}
                className="grid size-5 shrink-0 place-items-center rounded-md font-mono text-[14px] leading-none text-label opacity-0 transition-opacity group-hover/project:opacity-100 hover:bg-[var(--sw-sunken)] hover:text-foreground focus-visible:opacity-100"
              >
                +
              </button>
            </div>
            <ul>
              {sessions.map((session: SessionDto) => {
                const focused = session.id === focusedSessionId;
                return (
                  <li key={session.id}>
                    <button
                      type="button"
                      onClick={() => onOpenSession(project.id, session.id)}
                      aria-current={focused ? "true" : undefined}
                      className={`flex w-full items-center gap-1.5 py-[3px] pr-3 pl-[26px] text-left transition-colors hover:bg-[var(--sw-sunken)] ${
                        focused
                          ? "border-l-[3px] border-[var(--sw-accent)] bg-wash pl-[23px] hover:bg-wash"
                          : ""
                      }`}
                    >
                      <StatusDot
                        tone={statusTone(session.status)}
                        pulse={session.status === "running"}
                        size={6}
                      />
                      <span
                        className={`truncate font-sans text-[13px] ${
                          focused ? "text-foreground" : "text-ink-2"
                        }`}
                      >
                        {sessionTitle(session)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

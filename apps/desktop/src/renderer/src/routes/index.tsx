import { useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { CommandPalette } from "#/components/command-palette";
import { InboxRail } from "#/components/inbox";
import { Launcher } from "#/components/launcher";
import { ProjectTree } from "#/components/project-tree";
import { TabBar } from "#/components/tab-bar";
import { TerminalPane } from "#/components/terminal-pane";
import { Titlebar } from "#/components/titlebar";
import { isUnauthorized, type SessionDto } from "#/lib/api";
import { useWorkbenchEvents } from "#/lib/events";
import { useKeybindings } from "#/lib/keys";
import { buildInbox, buildTree, type InboxRow } from "#/lib/model";
import { useNow } from "#/lib/now";
import { projectDetailQuery, projectsQuery } from "#/lib/queries";
import { markVisited, useVisited } from "#/lib/seen";
import { terminalFont } from "#/lib/terminal-font";
import { openShellTab, useWorkbench, workbench } from "#/lib/workbench";

const focusRow = (row: InboxRow) => {
  workbench.openSession(row.session.projectId, row.session.id);
};

/**
 * The main screen (BRIEF.md): project tree and inbox on the left, tabs above
 * one dominant terminal on the right. Herdr's shape, Mend's engine — every
 * tab is a PTY in a Mend-managed workspace.
 */
export const Route = createFileRoute("/")({
  component: Main,
});

function Main() {
  useWorkbenchEvents();
  const navigate = useNavigate();
  const now = useNow();
  const visited = useVisited();
  const bench = useWorkbench();
  const [launcherFor, setLauncherFor] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shellError, setShellError] = useState<string | null>(null);

  const projects = useQuery(projectsQuery);
  const details = useQueries({
    queries: (projects.data ?? []).map((project) => projectDetailQuery(project.id)),
  });
  const data = useMemo(
    () =>
      (projects.data ?? []).map((project, i) => ({
        project,
        sessions: details[i]?.data?.sessions ?? [],
      })),
    [projects.data, details],
  );

  const tree = useMemo(() => buildTree(data), [data]);
  const inbox = useMemo(() => buildInbox(data, visited), [data, visited]);
  const sessions = useMemo(() => {
    const map = new Map<string, SessionDto>();
    for (const { sessions: list } of data) for (const s of list) map.set(s.id, s);
    return map;
  }, [data]);

  // The focused project defaults to the first one the server lists.
  const focusedProjectId =
    bench.focusedProjectId !== null && data.some((d) => d.project.id === bench.focusedProjectId)
      ? bench.focusedProjectId
      : (data[0]?.project.id ?? null);
  const focusedProject = data.find((d) => d.project.id === focusedProjectId) ?? null;
  const projectTabs =
    focusedProjectId !== null
      ? (bench.byProject[focusedProjectId] ?? { tabs: [], focused: 0 })
      : { tabs: [], focused: 0 };
  const focusedTab = projectTabs.tabs[projectTabs.focused] ?? null;
  const focusedSessionId =
    focusedTab !== null && focusedTab.kind === "session" ? focusedTab.sessionId : null;
  const focusedSession = focusedTab !== null ? (sessions.get(focusedTab.sessionId) ?? null) : null;

  // Viewing a settled session clears its unseen "done" — stamped at the
  // settle time so a later settle still gets its signal (t3's model).
  useEffect(() => {
    if (focusedSessionId === null) return;
    const session = sessions.get(focusedSessionId);
    if (session !== undefined && session.settledAt !== null) {
      markVisited(focusedSessionId, session.settledAt);
    }
  }, [focusedSessionId, sessions]);

  // Tabs whose session vanished (removed on the server) leave quietly.
  useEffect(() => {
    if (focusedProject === null || !details.every((d) => d.isSuccess)) return;
    workbench.prune(focusedProject.project.id, new Set(sessions.keys()));
  }, [focusedProject, details, sessions]);

  const projectOrder = tree.map((t) => t.project.id);
  const moveProject = (delta: number) => {
    if (focusedProjectId === null || projectOrder.length === 0) return;
    const index = projectOrder.indexOf(focusedProjectId);
    const next = projectOrder[index + delta];
    if (next !== undefined) workbench.focusProject(next);
  };
  const moveSession = (delta: number) => {
    const order = inbox.ordered;
    if (order.length === 0) return;
    const index = order.findIndex((row) => row.session.id === focusedSessionId);
    // No current session: start at the top. Otherwise step without wrapping.
    const target = index === -1 ? order[0] : order[index + delta];
    if (target !== undefined) focusRow(target);
  };

  useKeybindings({
    nextSession: () => moveSession(1),
    prevSession: () => moveSession(-1),
    nextProject: () => moveProject(1),
    prevProject: () => moveProject(-1),
    newShellTab: () => {
      if (focusedProjectId !== null) {
        setShellError(null);
        openShellTab(focusedProjectId).catch((error: unknown) => {
          setShellError(error instanceof Error ? error.message : String(error));
        });
      }
    },
    closeTab: () => {
      if (focusedProjectId !== null && projectTabs.tabs.length > 0) {
        workbench.closeTab(focusedProjectId, projectTabs.focused);
      }
    },
    nextTab: () => {
      if (focusedProjectId !== null && projectTabs.tabs.length > 0) {
        workbench.focusTab(focusedProjectId, (projectTabs.focused + 1) % projectTabs.tabs.length);
      }
    },
    prevTab: () => {
      if (focusedProjectId !== null && projectTabs.tabs.length > 0) {
        workbench.focusTab(
          focusedProjectId,
          (projectTabs.focused - 1 + projectTabs.tabs.length) % projectTabs.tabs.length,
        );
      }
    },
    jumpInbox: (index) => {
      const row = inbox.ordered[index];
      if (row !== undefined) focusRow(row);
    },
    togglePalette: () => setPaletteOpen((value) => !value),
    fontBigger: terminalFont.bigger,
    fontSmaller: terminalFont.smaller,
    fontReset: terminalFont.reset,
    openSettings: () => void navigate({ to: "/settings" }),
  });

  const unauthorized =
    isUnauthorized(projects.error) || details.some((d) => isUnauthorized(d.error));
  if (unauthorized) return <Navigate to="/connect" search={{ reason: "unauthorized" }} />;

  return (
    <>
      <Titlebar liveCount={details.every((d) => d.isSuccess) ? inbox.active.length : null} />
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Projects and inbox"
          className="flex h-full w-[264px] shrink-0 flex-col overflow-hidden border-r border-rule bg-background"
        >
          <ProjectTree
            tree={tree}
            focusedProjectId={focusedProjectId}
            focusedSessionId={focusedSessionId}
            onFocusProject={(id) => workbench.focusProject(id)}
            onOpenSession={(projectId, sessionId) => workbench.openSession(projectId, sessionId)}
            onLaunch={(projectId) => setLauncherFor(projectId)}
          />
          <InboxRail
            inbox={inbox}
            focusedSessionId={focusedSessionId}
            now={now}
            onFocus={focusRow}
          />
        </nav>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel">
          {focusedProject !== null && (
            <TabBar
              tabs={projectTabs.tabs}
              focused={projectTabs.focused}
              sessions={sessions}
              opening={bench.opening === focusedProjectId}
              onFocus={(index) => workbench.focusTab(focusedProject.project.id, index)}
              onClose={(index) => workbench.closeTab(focusedProject.project.id, index)}
              onNewShell={() => {
                setShellError(null);
                openShellTab(focusedProject.project.id).catch((error: unknown) => {
                  setShellError(error instanceof Error ? error.message : String(error));
                });
              }}
            />
          )}
          {focusedTab !== null ? (
            <TerminalPane
              key={
                focusedTab.kind === "session"
                  ? `s:${focusedTab.sessionId}`
                  : `p:${focusedTab.sessionId}:${focusedTab.processId ?? "pty"}`
              }
              tab={focusedTab}
              session={focusedSession}
            />
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center">
              <div className="max-w-sm text-center">
                <p className="font-mono text-[12px] tracking-wider text-faint uppercase">
                  {projects.isPending ? "reading projects…" : "no tabs open"}
                </p>
                {!projects.isPending && (
                  <p className="mt-3 font-sans text-[14px] leading-relaxed text-muted-foreground">
                    Ctrl+Shift+T opens a mend shell in{" "}
                    {focusedProject === null ? "the project" : focusedProject.project.name}; + on a
                    project launches an agent session. Every terminal is a Mend-managed workspace.
                  </p>
                )}
              </div>
            </div>
          )}
          {shellError !== null && (
            <p className="border-t border-rule px-3 py-1.5 font-sans text-[12.5px] text-danger">
              shell failed — {shellError}
            </p>
          )}
        </main>
      </div>

      {projects.isError && !unauthorized && (
        <p className="absolute right-4 bottom-3 font-sans text-[12.5px] text-danger">
          {projects.error instanceof Error ? projects.error.message : "could not read projects"}
        </p>
      )}
      {launcherFor !== null && (
        <Launcher
          projectId={launcherFor}
          projectName={data.find((d) => d.project.id === launcherFor)?.project.name ?? "project"}
          onLaunched={(session) => {
            setLauncherFor(null);
            workbench.openSession(session.projectId, session.id);
          }}
          onClose={() => setLauncherFor(null)}
        />
      )}
      {paletteOpen && (
        <CommandPalette
          rows={inbox.ordered}
          onPick={focusRow}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </>
  );
}

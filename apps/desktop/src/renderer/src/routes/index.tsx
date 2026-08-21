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
import { isUnauthorized, stopShell, type SessionDto, type SessionProcessDto } from "#/lib/api";
import { useWorkbenchEvents } from "#/lib/events";
import { useKeybindings } from "#/lib/keys";
import { buildInbox, buildTree, type InboxRow } from "#/lib/model";
import { useNow } from "#/lib/now";
import {
  projectDetailQuery,
  projectsQuery,
  queryClient,
  sessionProcessesQuery,
} from "#/lib/queries";
import { markVisited, useVisited } from "#/lib/seen";
import { terminalFont } from "#/lib/terminal-font";
import { openShellTab, useWorkbench, workbench } from "#/lib/workbench";

const focusRow = (row: InboxRow) => {
  workbench.openSession(row.session.projectId, row.session.id);
};

/**
 * The main screen (BRIEF.md): project tree and inbox on the left, tabs above
 * one dominant terminal on the right. Every writable supporting shell belongs
 * to a visible session and its change.
 */
export const Route = createFileRoute("/")({
  component: Main,
});

function Main() {
  useWorkbenchEvents();
  const navigate = useNavigate();
  const now = useNow();
  const visited = useVisited();
  const layout = useWorkbench();
  const [launcherFor, setLauncherFor] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shellError, setShellError] = useState<string | null>(null);

  const projects = useQuery(projectsQuery);
  const details = useQueries({
    queries: (projects.data ?? []).map((project) => projectDetailQuery(project.id)),
  });
  const data = useMemo(
    () =>
      (projects.data ?? []).map((project, index) => ({
        project,
        sessions: details[index]?.data?.sessions ?? [],
      })),
    [projects.data, details],
  );
  const sessionList = useMemo(() => data.flatMap((entry) => entry.sessions), [data]);
  const processQueries = useQueries({
    queries: sessionList.map((session) => sessionProcessesQuery(session.id)),
  });

  const tree = useMemo(() => buildTree(data), [data]);
  const inbox = useMemo(() => buildInbox(data, visited), [data, visited]);
  const sessions = useMemo(() => {
    const map = new Map<string, SessionDto>();
    for (const session of sessionList) map.set(session.id, session);
    return map;
  }, [sessionList]);
  const processes = useMemo(() => {
    const map = new Map<string, SessionProcessDto>();
    for (const query of processQueries) {
      for (const process of query.data ?? []) map.set(process.id, process);
    }
    return map;
  }, [processQueries]);

  // The focused project defaults to the first one the server lists.
  const focusedProjectId =
    layout.focusedProjectId !== null &&
    data.some((entry) => entry.project.id === layout.focusedProjectId)
      ? layout.focusedProjectId
      : (data[0]?.project.id ?? null);
  const focusedProject = data.find((entry) => entry.project.id === focusedProjectId) ?? null;
  const projectTabs =
    focusedProjectId === null
      ? { tabs: [], focused: 0 }
      : (layout.byProject[focusedProjectId] ?? { tabs: [], focused: 0 });
  const focusedTab = projectTabs.tabs[projectTabs.focused] ?? null;
  const focusedSessionId = focusedTab?.sessionId ?? null;
  const focusedSession =
    focusedSessionId === null ? null : (sessions.get(focusedSessionId) ?? null);
  const focusedProcess =
    focusedTab?.kind === "shell" ? (processes.get(focusedTab.processId) ?? null) : null;

  // Viewing any tab owned by a settled session clears its unseen completion.
  useEffect(() => {
    if (focusedSessionId === null) return;
    const session = sessions.get(focusedSessionId);
    if (session?.settledAt !== null && session?.settledAt !== undefined) {
      markVisited(focusedSessionId, session.settledAt);
    }
  }, [focusedSessionId, sessions]);

  // The server owns process existence. On the first complete read, restore live
  // shells; later reads prune ended processes without reopening detached tabs.
  useEffect(() => {
    if (!details.every((query) => query.isSuccess)) return;
    if (!processQueries.every((query) => query.isSuccess)) return;
    for (const entry of data) {
      const sessionIds = new Set(entry.sessions.map((session) => session.id));
      const shellProcesses = [...processes.values()].filter((process) =>
        sessionIds.has(process.sessionId),
      );
      workbench.reconcileProject(entry.project.id, sessionIds, shellProcesses);
    }
  }, [data, details, processQueries, processes]);

  const requestShell = () => {
    if (focusedProjectId === null) return;
    if (focusedSessionId === null) {
      setLauncherFor(focusedProjectId);
      return;
    }
    setShellError(null);
    void openShellTab(focusedProjectId, focusedSessionId).catch((error: unknown) => {
      setShellError(error instanceof Error ? error.message : String(error));
    });
  };

  const closeTabAt = async (index: number) => {
    if (focusedProjectId === null) return;
    const tab = projectTabs.tabs[index];
    if (tab === undefined) return;
    if (tab.kind === "session") {
      workbench.detachTab(focusedProjectId, index);
      return;
    }
    const process = processes.get(tab.processId);
    const label = process?.label ?? "this shell";
    if (
      !window.confirm(
        `Stop ${label}? This ends its process group.\n\nUse Detach tab to leave it running.`,
      )
    ) {
      return;
    }
    setShellError(null);
    try {
      await stopShell(tab.processId);
      workbench.detachTab(focusedProjectId, index);
      void queryClient.invalidateQueries({
        queryKey: ["session", tab.sessionId, "processes"],
      });
    } catch (error) {
      setShellError(error instanceof Error ? error.message : String(error));
    }
  };

  const projectOrder = tree.map((entry) => entry.project.id);
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
    const target = index === -1 ? order[0] : order[index + delta];
    if (target !== undefined) focusRow(target);
  };

  useKeybindings({
    nextSession: () => moveSession(1),
    prevSession: () => moveSession(-1),
    nextProject: () => moveProject(1),
    prevProject: () => moveProject(-1),
    newShellTab: requestShell,
    closeTab: () => void closeTabAt(projectTabs.focused),
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
    isUnauthorized(projects.error) ||
    details.some((query) => isUnauthorized(query.error)) ||
    processQueries.some((query) => isUnauthorized(query.error));
  if (unauthorized) return <Navigate to="/connect" search={{ reason: "unauthorized" }} />;

  return (
    <>
      <Titlebar
        liveCount={details.every((query) => query.isSuccess) ? inbox.active.length : null}
      />
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
              processes={processes}
              opening={layout.opening === focusedSessionId}
              onFocus={(index) => workbench.focusTab(focusedProject.project.id, index)}
              onClose={(index) => void closeTabAt(index)}
              onNewShell={requestShell}
            />
          )}
          {focusedTab === null ? (
            <div className="flex min-h-0 flex-1 items-center justify-center">
              <div className="max-w-sm text-center">
                <p className="font-mono text-[12px] tracking-wider text-faint uppercase">
                  {projects.isPending ? "reading projects…" : "no tabs open"}
                </p>
                {!projects.isPending && (
                  <p className="mt-3 font-sans text-[14px] leading-relaxed text-muted-foreground">
                    Choose a session, then press Ctrl+Shift+T for a supporting shell in its
                    worktree. With only a project focused, the shortcut opens the session launcher.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <TerminalPane
              key={
                focusedTab.kind === "session"
                  ? `s:${focusedTab.sessionId}`
                  : `p:${focusedTab.processId}`
              }
              tab={focusedTab}
              session={focusedSession}
              process={focusedProcess}
              onDetach={() => {
                if (focusedProjectId !== null) {
                  workbench.detachTab(focusedProjectId, projectTabs.focused);
                }
              }}
              onReview={(changeId, sliceId) => {
                void navigate({
                  to: "/review/$changeId/$sliceId",
                  params: { changeId, sliceId },
                });
              }}
            />
          )}
          {shellError !== null && (
            <p className="border-t border-rule px-3 py-1.5 font-sans text-[12.5px] text-danger">
              shell action failed: {shellError}
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
          projectName={
            data.find((entry) => entry.project.id === launcherFor)?.project.name ?? "project"
          }
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

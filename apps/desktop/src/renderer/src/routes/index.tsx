import { useContextMenu } from "@mend/ui/context-menu";
import { useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { CommandPalette } from "#/components/command-palette";
import { Launcher, ProjectPicker, SessionComposer } from "#/components/launcher";
import { ServicesSheet } from "#/components/services-sheet";
import { Sidebar } from "#/components/sidebar";
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
  servicesQuery,
  sessionProcessesQuery,
} from "#/lib/queries";
import { markVisited, useVisited } from "#/lib/seen";
import { serviceGlance, servicesForSession, type ServiceGlance } from "#/lib/services";
import { terminalFont } from "#/lib/terminal-font";
import { openShellTab, useWorkbench, workbench } from "#/lib/workbench";

const focusRow = (row: InboxRow) => {
  workbench.openSession(row.session.projectId, row.session.id);
};

/** Which project trees are open — any number at once; remembered per machine. */
const EXPANDED_KEY = "mend-sidebar-expanded";
const readExpanded = (): ReadonlyArray<string> | null => {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : null;
  } catch {
    return null;
  }
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
  const [servicesFor, setServicesFor] = useState<string | null>(null);
  /** null = nothing stored yet; the focused project's tree opens by default. */
  const [expandedStored, setExpandedStored] = useState<ReadonlyArray<string> | null>(readExpanded);
  const tabMenu = useContextMenu();
  const [terminalFocusRequest, setTerminalFocusRequest] = useState(0);
  const [shellError, setShellError] = useState<string | null>(null);
  const closeServices = () => {
    setServicesFor(null);
    setTerminalFocusRequest((request) => request + 1);
  };

  const projects = useQuery(projectsQuery);
  const serviceViews = useQuery(servicesQuery);
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
  /** Global order for the palette; per-project rows for the sidebar tree. */
  const inbox = useMemo(() => buildInbox(data, visited), [data, visited]);
  const rowsByProject = useMemo(() => {
    const map = new Map<string, ReadonlyArray<InboxRow>>();
    for (const entry of data) {
      const scoped = buildInbox([entry], visited);
      map.set(entry.project.id, [...scoped.active, ...scoped.settled]);
    }
    return map;
  }, [data, visited]);
  const serviceGlances = useMemo(() => {
    const map = new Map<string, Array<ServiceGlance>>();
    for (const view of serviceViews.data ?? []) {
      const rows = map.get(view.service.sessionId) ?? [];
      rows.push(serviceGlance(view));
      map.set(view.service.sessionId, rows);
    }
    return map;
  }, [serviceViews.data]);
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
  const focusedServices =
    focusedSessionId === null ? [] : servicesForSession(serviceViews.data ?? [], focusedSessionId);

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

  const closeTabAt = async (index: number, options?: { readonly skipConfirm?: boolean }) => {
    if (focusedProjectId === null) return;
    const tab = projectTabs.tabs[index];
    if (tab === undefined) return;
    if (tab.kind === "session" || tab.kind === "logs") {
      workbench.detachTab(focusedProjectId, index);
      return;
    }
    const process = processes.get(tab.processId);
    const label = process?.label ?? "this shell";
    if (
      options?.skipConfirm !== true &&
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

  const openTabMenu = (index: number, event: React.MouseEvent) => {
    const tab = projectTabs.tabs[index];
    if (tab === undefined) return;
    const process = tab.kind === "shell" ? (processes.get(tab.processId) ?? null) : null;
    tabMenu.openMenu(event, {
      title:
        tab.kind === "session"
          ? (sessions.get(tab.sessionId)?.branch ?? "session")
          : tab.kind === "shell"
            ? (process?.label ?? "shell")
            : `${tab.name} · logs`,
      entries:
        tab.kind === "shell"
          ? [
              {
                label: "Detach tab",
                onSelect: () => {
                  if (focusedProjectId !== null) workbench.detachTab(focusedProjectId, index);
                },
              },
              {
                label: "Stop shell",
                confirm: "Stop the process group?",
                danger: true,
                onSelect: () => void closeTabAt(index, { skipConfirm: true }),
              },
            ]
          : [
              {
                label: tab.kind === "logs" ? "Close" : "Detach tab",
                onSelect: () => {
                  if (focusedProjectId !== null) workbench.detachTab(focusedProjectId, index);
                },
              },
            ],
    });
  };

  const projectOrder = tree.map((entry) => entry.project.id);
  const moveProject = (delta: number) => {
    if (focusedProjectId === null || projectOrder.length === 0) return;
    const index = projectOrder.indexOf(focusedProjectId);
    const next = projectOrder[index + delta];
    if (next !== undefined) workbench.focusProject(next);
  };

  // Any number of trees may be open; before the user ever toggles, the
  // focused project's tree is the one that starts open.
  const expandedIds = useMemo(
    () => new Set(expandedStored ?? (focusedProjectId === null ? [] : [focusedProjectId])),
    [expandedStored, focusedProjectId],
  );
  const toggleProject = (id: string) => {
    workbench.focusProject(id);
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const stored = [...next];
    setExpandedStored(stored);
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify(stored));
    } catch {
      // Storage unavailable — in-memory state still works for this window.
    }
  };

  // Session cycling and jump pills walk the visible rows of every open tree,
  // in tree order — the same order the sidebar numbers them.
  const visibleRows = useMemo(
    () =>
      tree.flatMap((entry) =>
        expandedIds.has(entry.project.id) ? (rowsByProject.get(entry.project.id) ?? []) : [],
      ),
    [tree, expandedIds, rowsByProject],
  );
  const moveSession = (delta: number) => {
    if (visibleRows.length === 0) return;
    const index = visibleRows.findIndex((row) => row.session.id === focusedSessionId);
    const target = index === -1 ? visibleRows[0] : visibleRows[index + delta];
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
      const row = visibleRows[index];
      if (row !== undefined) focusRow(row);
    },
    togglePalette: () => setPaletteOpen((value) => !value),
    toggleServices: () => {
      if (focusedSessionId === null) return;
      if (servicesFor === focusedSessionId) closeServices();
      else setServicesFor(focusedSessionId);
    },
    fontBigger: terminalFont.bigger,
    fontSmaller: terminalFont.smaller,
    fontReset: terminalFont.reset,
    openSettings: () => void navigate({ to: "/settings" }),
  });

  const launcherProject =
    launcherFor === null
      ? null
      : (data.find((entry) => entry.project.id === launcherFor)?.project ?? null);

  const unauthorized =
    isUnauthorized(projects.error) ||
    details.some((query) => isUnauthorized(query.error)) ||
    processQueries.some((query) => isUnauthorized(query.error)) ||
    isUnauthorized(serviceViews.error);
  if (unauthorized) return <Navigate to="/connect" search={{ reason: "unauthorized" }} />;

  return (
    <>
      <Titlebar
        liveCount={details.every((query) => query.isSuccess) ? inbox.active.length : null}
      />
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Projects and sessions"
          className="flex h-full w-[272px] shrink-0 flex-col overflow-hidden border-r border-rule bg-canvas dark:border-[var(--sw-rule)] dark:bg-[color-mix(in_oklab,var(--sw-panel)_92%,white)]"
        >
          <Sidebar
            tree={tree}
            rowsByProject={rowsByProject}
            expandedIds={expandedIds}
            focusedProjectId={focusedProjectId}
            focusedSessionId={focusedSessionId}
            now={now}
            serviceGlances={serviceGlances}
            onToggleProject={toggleProject}
            onLaunch={(projectId) => setLauncherFor(projectId)}
            onFocus={focusRow}
            onServiceFocus={(row) => {
              focusRow(row);
              setServicesFor(row.session.id);
            }}
          />
        </nav>

        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-panel">
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
              onTabMenu={openTabMenu}
            />
          )}
          {tabMenu.menuElement}
          {focusedTab === null ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-8 py-10">
              {focusedProject === null ? (
                <p className="font-mono text-[12px] tracking-wider text-faint uppercase">
                  {projects.isPending ? "reading projects…" : "no projects"}
                </p>
              ) : (
                <div className="flex w-full max-w-[640px] flex-col items-center">
                  <div className="mb-4 flex w-full items-center gap-1 font-sans text-[14px] font-medium text-foreground">
                    <span className="pl-2">New session ·</span>
                    <ProjectPicker
                      projects={data.map((entry) => entry.project)}
                      projectId={focusedProject.project.id}
                      onPick={workbench.focusProject}
                    />
                  </div>
                  <SessionComposer
                    key={focusedProject.project.id}
                    project={focusedProject.project}
                    variant="inline"
                    onLaunched={(session) => workbench.openSession(session.projectId, session.id)}
                  />
                  <p className="mt-5 max-w-sm text-center font-sans text-[12.5px] leading-relaxed text-muted-foreground">
                    Or choose a session in the tree; Ctrl+Shift+T opens a supporting shell in its
                    worktree.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <TerminalPane
              key={
                focusedTab.kind === "session"
                  ? `s:${focusedTab.sessionId}`
                  : focusedTab.kind === "shell"
                    ? `p:${focusedTab.processId}`
                    : `l:${focusedTab.processId}`
              }
              tab={focusedTab}
              session={focusedSession}
              process={focusedProcess}
              serviceCount={focusedServices.length}
              serviceAttention={focusedServices.some((service) => service.attention !== null)}
              terminalFocusRequest={terminalFocusRequest}
              onServices={() => setServicesFor(focusedSessionId)}
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
          {focusedSession !== null && servicesFor === focusedSession.id && (
            <ServicesSheet
              session={focusedSession}
              views={serviceViews.data ?? []}
              onClose={closeServices}
              onOpenLogsTab={(processId, name) => {
                closeServices();
                workbench.openLogs(focusedSession.projectId, focusedSession.id, processId, name);
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
      {launcherProject !== null && (
        <Launcher
          project={launcherProject}
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

import { useSyncExternalStore } from "react";

import {
  createSession,
  launchSession,
  LIVE_STATUSES,
  openShell,
  projectDetail,
  stopSession,
  type SessionDto,
} from "#/lib/api";
import { benchArgv } from "#/lib/app-settings";
import { queryClient } from "#/lib/queries";

/**
 * The working set: which project is focused, and per project the open tabs.
 * Every tab is a PTY (BRIEF.md). A session tab views an agent session's
 * terminal; a shell tab is a mend shell — a shell PTY in the project's bench
 * workspace. Closing a session tab detaches the view; closing a shell tab
 * abandons that shell. Persisted per machine.
 */

export type Tab =
  | { readonly kind: "session"; readonly sessionId: string }
  | {
      readonly kind: "shell";
      /** The bench session hosting this shell's workspace. */
      readonly sessionId: string;
      /** Null: the bench's own launch PTY (the first shell); else a process. */
      readonly processId: string | null;
    };

export interface ProjectTabs {
  readonly tabs: ReadonlyArray<Tab>;
  readonly focused: number;
}

export interface WorkbenchState {
  readonly focusedProjectId: string | null;
  readonly byProject: Record<string, ProjectTabs>;
  /** A shell tab is being provisioned for this project (bench may be building). */
  readonly opening: string | null;
}

const KEY = "mend-workbench";
export const BENCH_LABEL = "bench";

const EMPTY: WorkbenchState = { focusedProjectId: null, byProject: {}, opening: null };

const read = (): WorkbenchState => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return EMPTY;
    const record = parsed as Partial<WorkbenchState>;
    return {
      focusedProjectId:
        typeof record.focusedProjectId === "string" ? record.focusedProjectId : null,
      byProject:
        typeof record.byProject === "object" && record.byProject !== null
          ? (record.byProject as Record<string, ProjectTabs>)
          : {},
      opening: null,
    };
  } catch {
    return EMPTY;
  }
};

let state: WorkbenchState = read();
const listeners = new Set<() => void>();

const set = (next: WorkbenchState) => {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...next, opening: null }));
  } catch {
    // Storage unavailable — the in-memory state still works.
  }
  for (const listener of listeners) listener();
};

export const useWorkbench = (): WorkbenchState =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => state,
  );

const tabsOf = (projectId: string): ProjectTabs =>
  state.byProject[projectId] ?? { tabs: [], focused: 0 };

const tabKey = (tab: Tab): string =>
  tab.kind === "session" ? `s:${tab.sessionId}` : `p:${tab.sessionId}:${tab.processId ?? "pty"}`;

const withTabs = (projectId: string, next: ProjectTabs): WorkbenchState => ({
  ...state,
  focusedProjectId: projectId,
  byProject: { ...state.byProject, [projectId]: next },
});

export const workbench = {
  focusProject: (projectId: string) => {
    if (state.focusedProjectId === projectId) return;
    set({ ...state, focusedProjectId: projectId });
  },

  focusTab: (projectId: string, index: number) => {
    const current = tabsOf(projectId);
    if (index < 0 || index >= current.tabs.length) return;
    set(withTabs(projectId, { ...current, focused: index }));
  },

  /** Open (or raise) the tab viewing an agent session's terminal. */
  openSession: (projectId: string, sessionId: string) => {
    const current = tabsOf(projectId);
    const existing = current.tabs.findIndex(
      (t) => t.kind === "session" && t.sessionId === sessionId,
    );
    if (existing !== -1) {
      set(withTabs(projectId, { ...current, focused: existing }));
      return;
    }
    const tab: Tab = { kind: "session", sessionId };
    set(withTabs(projectId, { tabs: [...current.tabs, tab], focused: current.tabs.length }));
  },

  closeTab: (projectId: string, index: number) => {
    const current = tabsOf(projectId);
    const tabs = current.tabs.filter((_, i) => i !== index);
    const focused = Math.min(
      current.focused >= index ? current.focused - 1 : current.focused,
      tabs.length - 1,
    );
    set(withTabs(projectId, { tabs, focused: Math.max(0, focused) }));
  },

  /** Drop tabs whose session no longer exists. */
  prune: (projectId: string, known: ReadonlySet<string>) => {
    const current = tabsOf(projectId);
    const tabs = current.tabs.filter((t) => known.has(t.sessionId));
    if (tabs.length === current.tabs.length) return;
    set(
      withTabs(projectId, {
        tabs,
        focused: Math.max(0, Math.min(current.focused, tabs.length - 1)),
      }),
    );
  },
};

/**
 * New shell tab: the bench mechanism (BRIEF.md §tabs). The project's bench is
 * one session with a shell harness; its launch PTY is the first shell, every
 * further tab is `openShell` into the same workspace. Created lazily here —
 * a first shell on a cold project builds a workspace and can take a while.
 */
export const openShellTab = async (projectId: string): Promise<void> => {
  if (state.opening !== null) return;
  set({ ...state, opening: projectId });
  try {
    const detail = await projectDetail(projectId);
    const bench = detail.sessions.find(
      (s: SessionDto) =>
        s.harness === "shell" && s.label === BENCH_LABEL && LIVE_STATUSES.has(s.status),
    );
    const freshBench = async (): Promise<Tab> => {
      const image = detail.project.workspaceImage;
      const imageShell =
        image !== null && image.mode === "family" && typeof image.shell === "string"
          ? image.shell
          : "bash";
      const created = await createSession(projectId, "shell", BENCH_LABEL);
      await launchSession(created.id, [...benchArgv(imageShell)]);
      return { kind: "shell", sessionId: created.id, processId: null };
    };
    let tab: Tab;
    if (bench === undefined) {
      tab = await freshBench();
    } else {
      try {
        const process = await openShell(bench.id);
        tab = { kind: "shell", sessionId: bench.id, processId: process.id };
      } catch {
        // A bench the server still calls live can sit on a dead workspace
        // (its container exited; opening a PTY there times out). Ask the
        // server to reconcile it, then build a fresh bench rather than
        // surfacing the corpse's error.
        await stopSession(bench.id).catch(() => undefined);
        tab = await freshBench();
      }
    }
    void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    const current = tabsOf(projectId);
    const existing = current.tabs.findIndex((t) => tabKey(t) === tabKey(tab));
    set({
      ...withTabs(
        projectId,
        existing === -1
          ? { tabs: [...current.tabs, tab], focused: current.tabs.length }
          : { ...current, focused: existing },
      ),
      opening: null,
    });
  } catch (error) {
    set({ ...state, opening: null });
    throw error;
  }
};

import type { UseNavigateResult } from "@tanstack/react-router";

import type { ContextMenuEntry, ContextMenuSpec } from "#/components/context-menu";
import {
  checkpointSession,
  createSession,
  launchSession,
  removeProject,
  removeSession,
  resumeSession,
  stopSession,
  type ProjectDto,
  type SessionAnnotationDto,
  type SessionDto,
} from "#/lib/api";
import { queryClient } from "#/lib/queries";

/** How each harness launches — mirrors the CLI's map; the server records either way. */
/** Harnesses the web can start; opencode stays CLI-only until it is exercised end to end. */
export const HARNESSES = ["claude", "codex", "shell"] as const;
export type Harness = (typeof HARNESSES)[number];

/** What each harness launches — shell is a plain bash in its own recorded worktree. */
const HARNESS_COMMANDS: Record<Harness, ReadonlyArray<string>> = {
  claude: ["claude"],
  codex: ["codex"],
  shell: ["bash"],
};

/** Session states with a live process behind them. */
export const LIVE_STATES: ReadonlySet<string> = new Set(["starting", "running", "waiting", "idle"]);

type Navigate = UseNavigateResult<string>;

/**
 * Fire a session: create the row, kick the supervised launch, land on the
 * session page — its terminal pane attaches the moment the workspace is
 * ready. The launch promise outlives the navigation (same SPA); a failure
 * settles the session server-side, so the page shows it.
 */
export const startSession = (navigate: Navigate, projectId: string, harness: Harness) =>
  createSession(projectId, harness).then((session) => {
    void launchSession(session.id, HARNESS_COMMANDS[harness])
      .catch(() => undefined)
      .finally(() => {
        void queryClient.invalidateQueries({ queryKey: ["session", session.id] });
      });
    return navigate({ to: "/sessions/$sessionId", params: { sessionId: session.id } });
  });

/** Clipboard write with a fallback for non-secure origins (LAN over http). */
export const copyText = (text: string) => {
  if (typeof navigator.clipboard?.writeText === "function") {
    void navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    return;
  }
  fallbackCopy(text);
};

const fallbackCopy = (text: string) => {
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  document.execCommand("copy");
  area.remove();
};

/** The right-click menu for a project row/card in a list. */
export const projectMenu = (project: ProjectDto, navigate: Navigate): ContextMenuSpec => {
  const entries: ContextMenuEntry[] = [
    {
      label: "Open project",
      onSelect: () =>
        void navigate({ to: "/projects/$projectId", params: { projectId: project.id } }),
    },
    "separator",
    ...HARNESSES.map(
      (harness): ContextMenuEntry => ({
        label: `Start ${harness} session`,
        onSelect: () => void startSession(navigate, project.id, harness),
      }),
    ),
    "separator",
    { label: "Copy store path", flash: "Copied", onSelect: () => copyText(project.storePath) },
  ];
  const originUrl = project.originUrl;
  if (originUrl !== null) {
    entries.push({
      label: "Copy origin URL",
      flash: "Copied",
      onSelect: () => copyText(originUrl),
    });
  }
  entries.push("separator", {
    label: "Remove project…",
    confirm: "Really remove project and store copy?",
    danger: true,
    onSelect: () => {
      // The list refetches before the detail cache is dropped, so the
      // removed project's detail query unmounts instead of refetching a 404.
      void removeProject(project.id)
        .then(() => queryClient.invalidateQueries({ queryKey: ["projects"] }))
        .then(() => {
          queryClient.removeQueries({ queryKey: ["project", project.id] });
          return null;
        });
    },
  });
  return { title: project.name, entries };
};

/** The right-click menu for a session row/card in a list. */
export const sessionMenu = (
  session: SessionDto,
  annotation: SessionAnnotationDto | undefined,
  navigate: Navigate,
): ContextMenuSpec => {
  const live = LIVE_STATES.has(session.status);
  const entries: ContextMenuEntry[] = [
    {
      label: "Open session",
      onSelect: () =>
        void navigate({ to: "/sessions/$sessionId", params: { sessionId: session.id } }),
    },
  ];
  const changeId = annotation?.changeId ?? null;
  if (changeId !== null) {
    entries.push({
      label: "Open review",
      onSelect: () => void navigate({ to: "/changes/$changeId", params: { changeId } }),
    });
  }
  entries.push("separator");
  if (live) {
    entries.push(
      {
        label: "Mark checkpoint",
        onSelect: () =>
          void checkpointSession(session.id, "user-mark").then(() => invalidateSession(session)),
      },
      {
        label: "Stop session",
        onSelect: () =>
          void stopSession(session.id)
            .catch(() => undefined)
            .finally(() => invalidateSession(session)),
      },
    );
  } else {
    entries.push({
      // Same worktree, restored state, fresh workspace; harness null = last used.
      label: "Resume session",
      onSelect: () => {
        void resumeSession(session.id, null)
          .catch(() => undefined)
          .finally(() => invalidateSession(session));
        void navigate({ to: "/sessions/$sessionId", params: { sessionId: session.id } });
      },
    });
  }
  entries.push(
    "separator",
    { label: "Copy worktree path", flash: "Copied", onSelect: () => copyText(session.worktree) },
    { label: "Copy branch name", flash: "Copied", onSelect: () => copyText(session.branch) },
  );
  if (!live) {
    entries.push("separator", {
      label: "Delete session…",
      confirm: "Really delete session and worktree?",
      danger: true,
      onSelect: () => {
        void removeSession(session.id).then(() => {
          queryClient.removeQueries({ queryKey: ["session", session.id] });
          return queryClient.invalidateQueries({ queryKey: ["project", session.projectId] });
        });
      },
    });
  }
  return {
    title: `${session.harness}${session.label === null ? "" : ` — ${session.label}`}`,
    entries,
  };
};

const invalidateSession = (session: SessionDto) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: ["session", session.id] }),
    queryClient.invalidateQueries({ queryKey: ["project", session.projectId] }),
  ]);

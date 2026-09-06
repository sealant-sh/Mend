import { useSyncExternalStore } from "react";

/** Both presentations keep worktrees as parents of their sessions. */
export type WorktreeView = "list" | "cards";

const KEY = "mend-worktrees-view";
const listeners = new Set<() => void>();
let current: WorktreeView = "list";

if (typeof window !== "undefined") {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "list" || stored === "cards") current = stored;
  } catch {
    // The view still works when browser storage is unavailable.
  }
}

/** Remember the presentation without changing the worktree selection or drafts. */
export const setWorktreeView = (next: WorktreeView): void => {
  current = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Keep the choice in memory for this tab.
  }
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Read the saved list/cards preference without an effect or server-side storage. */
export const useWorktreeView = (): WorktreeView =>
  useSyncExternalStore(
    subscribe,
    () => current,
    () => "list",
  );

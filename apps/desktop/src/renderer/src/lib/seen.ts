import { useSyncExternalStore } from "react";

/**
 * Client-local read state, t3code's model (Sidebar.logic.ts hasUnseenCompletion,
 * uiStateStore markThreadVisited): a session is "unseen done" when it settled
 * after the last time its terminal was focused. Never-visited counts as READ —
 * a fresh install must not light up the whole history. Visits are stamped at
 * the session's settle time, not `now`, and never move backwards, so a later
 * settle still gets its signal.
 */

const KEY = "mend-last-visited";

type Visited = Record<string, string>;

const read = (): Visited => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return {};
  }
};

let visited: Visited = read();
const listeners = new Set<() => void>();

const write = (next: Visited) => {
  visited = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable — in-memory state still works for this run.
  }
  for (const listener of listeners) listener();
};

export const useVisited = (): Visited =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => visited,
  );

/** Stamp a visit at `at` (ISO). Monotonic: never moves the pointer backwards. */
export const markVisited = (sessionId: string, at: string): void => {
  const current = visited[sessionId];
  if (current !== undefined && Date.parse(current) >= Date.parse(at)) return;
  write({ ...visited, [sessionId]: at });
};

/** Unseen-done: settled after the last visit (never-visited = read). */
export const hasUnseenSettle = (
  visitedMap: Visited,
  sessionId: string,
  settledAt: string | null,
): boolean => {
  if (settledAt === null) return false;
  const lastVisited = visitedMap[sessionId];
  if (lastVisited === undefined) return false;
  const settled = Date.parse(settledAt);
  const seen = Date.parse(lastVisited);
  if (Number.isNaN(settled)) return false;
  if (Number.isNaN(seen)) return true;
  return settled > seen;
};

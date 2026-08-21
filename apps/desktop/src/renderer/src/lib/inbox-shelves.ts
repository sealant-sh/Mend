import { useSyncExternalStore } from "react";

/**
 * The inbox's two shelves (t3code Sidebar.tsx: settled expanded by default,
 * snoozed collapsed by default — "out of the way, never gone") and the
 * settled tail's paging. Lifted out of the rail so the route computes the
 * same visible, numbered row list the rail renders: Ctrl+1..9 must match
 * what is on screen.
 */

export interface InboxShelves {
  readonly settledExpanded: boolean;
  readonly snoozedExpanded: boolean;
  /** How many settled rows the tail currently shows (not persisted). */
  readonly settledShown: number;
}

export const SETTLED_INITIAL = 10;
export const SETTLED_PAGE = 25;

const KEY = "mend-inbox-shelves";
const FALLBACK: InboxShelves = {
  settledExpanded: true,
  snoozedExpanded: false,
  settledShown: SETTLED_INITIAL,
};

const read = (): InboxShelves => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return FALLBACK;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return FALLBACK;
    const record = parsed as { settledExpanded?: unknown; snoozedExpanded?: unknown };
    return {
      settledExpanded:
        typeof record.settledExpanded === "boolean"
          ? record.settledExpanded
          : FALLBACK.settledExpanded,
      snoozedExpanded:
        typeof record.snoozedExpanded === "boolean"
          ? record.snoozedExpanded
          : FALLBACK.snoozedExpanded,
      settledShown: SETTLED_INITIAL,
    };
  } catch {
    return FALLBACK;
  }
};

let state: InboxShelves = read();
const listeners = new Set<() => void>();

const set = (next: InboxShelves) => {
  state = next;
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        settledExpanded: next.settledExpanded,
        snoozedExpanded: next.snoozedExpanded,
      }),
    );
  } catch {
    // Storage unavailable — the shelf state still holds this window.
  }
  for (const listener of listeners) listener();
};

export const useInboxShelves = (): InboxShelves =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => state,
  );

export const inboxShelves = {
  toggleSettled: () => set({ ...state, settledExpanded: !state.settledExpanded }),
  toggleSnoozed: () => set({ ...state, snoozedExpanded: !state.snoozedExpanded }),
  showMoreSettled: () => set({ ...state, settledShown: state.settledShown + SETTLED_PAGE }),
  /** A scope flip resets the paging (t3: Sidebar.tsx 2153-2159). */
  resetPaging: () => {
    if (state.settledShown !== SETTLED_INITIAL) set({ ...state, settledShown: SETTLED_INITIAL });
  },
};

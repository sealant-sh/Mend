import { useSyncExternalStore } from "react";

/**
 * The terminal font — the knobs a terminal person reaches for first.
 * Persisted per machine; applied live through the surface's setFont (the
 * adapter re-measures the cell, refits the grid, and the PTY is resized to
 * the new cols/rows). Ctrl+Shift+= / − / 0 step, shrink, and reset the size;
 * the family is set in Settings. A family that measures as proportional is
 * silently replaced by the adapter's fallback stack (surface.ts) — Settings
 * runs the same probe and says so up front.
 */

export const DEFAULT_SIZE = 12;
export const DEFAULT_FAMILY = '"JetBrains Mono"';
const MIN_SIZE = 6;
const MAX_SIZE = 32;
const SIZE_KEY = "mend-terminal-font-size";
const FAMILY_KEY = "mend-terminal-font-family";

const clamp = (value: number): number => Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(value)));

const readSize = (): number => {
  try {
    const raw = localStorage.getItem(SIZE_KEY);
    if (raw === null) return DEFAULT_SIZE;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clamp(parsed) : DEFAULT_SIZE;
  } catch {
    return DEFAULT_SIZE;
  }
};

const readFamily = (): string => {
  try {
    const raw = localStorage.getItem(FAMILY_KEY);
    return raw === null || raw.trim() === "" ? DEFAULT_FAMILY : raw;
  } catch {
    return DEFAULT_FAMILY;
  }
};

export interface TerminalFontSetting {
  readonly family: string;
  readonly size: number;
}

let font: TerminalFontSetting = { family: readFamily(), size: readSize() };
const listeners = new Set<() => void>();

const persist = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable — the in-memory value still applies this run.
  }
};

const set = (next: TerminalFontSetting) => {
  if (next.family === font.family && next.size === font.size) return;
  font = next;
  persist(SIZE_KEY, String(next.size));
  persist(FAMILY_KEY, next.family);
  for (const listener of listeners) listener();
};

export const useTerminalFont = (): TerminalFontSetting =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => font,
  );

export const terminalFont = {
  bigger: () => set({ ...font, size: clamp(font.size + 1) }),
  smaller: () => set({ ...font, size: clamp(font.size - 1) }),
  reset: () => set({ ...font, size: DEFAULT_SIZE }),
  setSize: (size: number) => set({ ...font, size: clamp(size) }),
  setFamily: (family: string) =>
    set({ ...font, family: family.trim() === "" ? DEFAULT_FAMILY : family.trim() }),
};

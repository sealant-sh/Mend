import { useSyncExternalStore } from "react";

/**
 * Workbench defaults (BRIEF.md §settings). Small on purpose: the launcher's
 * default harness, and the command a new bench shell runs. Both persisted
 * per machine.
 */

export const HARNESSES = ["claude", "codex", "opencode"] as const;
export type Harness = (typeof HARNESSES)[number];

/** Empty means auto: follow the workspace image's login shell. */
export const DEFAULT_BENCH_COMMAND = "";

export interface AppSettings {
  readonly defaultHarness: Harness;
  /** Explicit bench command; "" follows the workspace image's login shell. */
  readonly benchCommand: string;
}

const KEY = "mend-app-settings";

const read = (): AppSettings => {
  const fallback: AppSettings = { defaultHarness: "claude", benchCommand: DEFAULT_BENCH_COMMAND };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return fallback;
    const record = parsed as Partial<AppSettings>;
    return {
      defaultHarness: HARNESSES.includes(record.defaultHarness as Harness)
        ? (record.defaultHarness as Harness)
        : fallback.defaultHarness,
      benchCommand: typeof record.benchCommand === "string" ? record.benchCommand.trim() : "",
    };
  } catch {
    return fallback;
  }
};

let settings: AppSettings = read();
const listeners = new Set<() => void>();

const set = (next: AppSettings) => {
  settings = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable — the in-memory settings still apply this run.
  }
  for (const listener of listeners) listener();
};

export const useAppSettings = (): AppSettings =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => settings,
  );

export const appSettings = {
  setDefaultHarness: (defaultHarness: Harness) => set({ ...settings, defaultHarness }),
  setBenchCommand: (raw: string) => set({ ...settings, benchCommand: raw.trim() }),
};

/**
 * The bench launch argv: the explicit command when one is set, else the
 * workspace image's login shell as a login shell — the image installed and
 * switched to it precisely so dotfiles take effect (domain settings.ts).
 */
export const benchArgv = (imageShell: string): ReadonlyArray<string> => {
  const parts = settings.benchCommand.split(/\s+/).filter((p) => p !== "");
  return parts.length === 0 ? [imageShell, "-l"] : parts;
};

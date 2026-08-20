import { useSyncExternalStore } from "react";

/**
 * Theme: system (follow the OS), or pinned light/dark. Same storage key and
 * `.dark` class contract as the web app, so the token sheet does the rest.
 */

export type ThemeMode = "system" | "light" | "dark";

const KEY = "mend-theme";
const query = window.matchMedia("(prefers-color-scheme: dark)");

const read = (): ThemeMode => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === "light" || raw === "dark" ? raw : "system";
  } catch {
    return "system";
  }
};

let mode: ThemeMode = read();
const listeners = new Set<() => void>();

const apply = () => {
  const dark = mode === "dark" || (mode === "system" && query.matches);
  document.documentElement.classList.toggle("dark", dark);
};

/** Called once from main.tsx: apply the stored mode and track the OS. */
export const startTheme = (): void => {
  apply();
  query.addEventListener("change", apply);
};

export const useThemeMode = (): ThemeMode =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => mode,
  );

export const setThemeMode = (next: ThemeMode): void => {
  if (next === mode) return;
  mode = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Storage unavailable — the in-memory mode still applies this run.
  }
  apply();
  for (const listener of listeners) listener();
};

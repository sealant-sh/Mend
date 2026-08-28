// Launch tunables: model, thinking effort, priority. Advisory catalogs
// mirrored from `@mend/domain/workbench` (harness-launch.ts) — the authority;
// mobile keeps a local transcription because pulling the domain package would
// drag the whole Effect runtime into the native bundle for three arrays. The
// contract keeps `model` free-form, so an out-of-date list only limits the
// picker, never what the server accepts.
//
// Chosen options persist per harness on device (same external-store pattern
// as preferences.ts) and ride `POST /sessions/:id/launch` at start.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/** `fast` = codex `service_tier=priority`; claude has no launch-time flag. */
export const FAST_CAPABLE_HARNESSES: ReadonlySet<string> = new Set(["codex"]);

export interface HarnessModelOption {
  readonly id: string;
  readonly label: string;
  readonly isDefault: boolean;
}

export const HARNESS_MODELS: Record<string, ReadonlyArray<HarnessModelOption>> = {
  claude: [
    { id: "claude-fable-5", label: "Fable 5", isDefault: true },
    { id: "claude-opus-5", label: "Opus 5", isDefault: false },
    { id: "claude-opus-4-8", label: "Opus 4.8", isDefault: false },
    { id: "claude-sonnet-5", label: "Sonnet 5", isDefault: false },
  ],
  codex: [
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", isDefault: true },
    { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", isDefault: false },
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", isDefault: false },
    { id: "gpt-5.5", label: "GPT-5.5", isDefault: false },
    { id: "gpt-5.4", label: "GPT-5.4", isDefault: false },
  ],
};

/** null = the harness's own default; the field stays off the launch wire. */
export interface LaunchOptions {
  readonly model: string | null;
  readonly effort: EffortLevel | null;
  readonly speed: "fast" | null;
}

export const DEFAULT_LAUNCH_OPTIONS: LaunchOptions = { model: null, effort: null, speed: null };

type LaunchPrefs = Readonly<Record<string, LaunchOptions>>;

const STORAGE_KEY = "mend-launch-options";

let current: LaunchPrefs = {};
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

const isEffort = (value: unknown): value is EffortLevel =>
  typeof value === "string" && (EFFORT_LEVELS as ReadonlyArray<string>).includes(value);

const parsePrefs = (raw: string): LaunchPrefs => {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    const prefs: Record<string, LaunchOptions> = {};
    for (const [harness, options] of Object.entries(value)) {
      if (typeof options !== "object" || options === null) continue;
      const row = options as Readonly<Record<string, unknown>>;
      prefs[harness] = {
        model: typeof row.model === "string" ? row.model : null,
        effort: isEffort(row.effort) ? row.effort : null,
        speed: row.speed === "fast" ? "fast" : null,
      };
    }
    return prefs;
  } catch {
    return {};
  }
};

void AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
  if (raw !== null) {
    current = parsePrefs(raw);
    notify();
  }
  return undefined;
});

export const setLaunchOptions = (harness: string, options: LaunchOptions): void => {
  current = { ...current, [harness]: options };
  notify();
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(current));
};

const subscribe = (onChange: () => void): (() => void) => {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
};

export const useLaunchOptions = (harness: string): LaunchOptions =>
  useSyncExternalStore(
    subscribe,
    () => current[harness] ?? DEFAULT_LAUNCH_OPTIONS,
    () => DEFAULT_LAUNCH_OPTIONS,
  );

import type { EffortLevel, PermissionMode, SpeedMode } from "@mend/domain/workbench";
import type { UseNavigateResult } from "@tanstack/react-router";

import { createSession, launchSessionStart } from "#/lib/api";
import { queryClient } from "#/lib/queries";

/** Harnesses the web can start; opencode stays CLI-only until it is exercised end to end. */
export const HARNESSES = ["claude", "codex", "shell"] as const;
export type Harness = (typeof HARNESSES)[number];

type Navigate = UseNavigateResult<string>;

/** One composed start, as the composer (or a quick-start menu) describes it. */
export interface LaunchSpec {
  readonly harness: Harness;
  /** Empty = a bare harness session, exactly as the quick-start buttons launch. */
  readonly prompt: string;
  readonly model?: string;
  readonly effort?: EffortLevel;
  readonly permissionMode?: PermissionMode;
  readonly speed?: SpeedMode;
  /** Branch or sha for the worktree; null = the project's default branch. */
  readonly base?: string | null;
}

/**
 * Fire a composed session: create the row, kick the supervised launch with
 * the structured start (the server assembles harness argv and seeds
 * auto-naming from the prompt), land on the session page — its terminal
 * pane attaches the moment the workspace is ready. The launch promise
 * outlives the navigation (same SPA); a failure settles the session
 * server-side, so the page shows it. A create failure rejects here — the
 * composer keeps the prompt and shows it.
 */
export const startComposedSession = (navigate: Navigate, projectId: string, spec: LaunchSpec) =>
  createSession(projectId, spec.harness, spec.base ?? null).then((session) => {
    const prompt = spec.prompt.trim();
    void launchSessionStart(session.id, {
      ...(prompt === "" ? {} : { prompt }),
      ...(spec.model === undefined ? {} : { model: spec.model }),
      ...(spec.effort === undefined ? {} : { effort: spec.effort }),
      ...(spec.permissionMode === undefined ? {} : { permissionMode: spec.permissionMode }),
      ...(spec.speed === undefined ? {} : { speed: spec.speed }),
    })
      .catch(() => undefined)
      .finally(() => {
        void queryClient.invalidateQueries({ queryKey: ["session", session.id] });
      });
    return navigate({ to: "/sessions/$sessionId", params: { sessionId: session.id } });
  });

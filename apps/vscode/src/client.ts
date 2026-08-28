import { setTimeout as wait } from "node:timers/promises";

import * as vscode from "vscode";

import type { ConnectionStore, MendConnection } from "./config.js";
import {
  SESSION_STATUSES,
  type LaunchStart,
  type Project,
  type ProjectDetail,
  type ProjectResolution,
  type RepositoryFacts,
  type Session,
  type SessionStatus,
} from "./types.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringField = (value: Record<string, unknown>, field: string): string => {
  const found = value[field];
  if (typeof found !== "string") throw new Error(`Mend returned an invalid ${field}.`);
  return found;
};

const nullableStringField = (value: Record<string, unknown>, field: string): string | null => {
  const found = value[field];
  if (found === null) return null;
  if (typeof found !== "string") throw new Error(`Mend returned an invalid ${field}.`);
  return found;
};

const parseProject = (value: unknown): Project => {
  if (!isRecord(value)) throw new Error("Mend returned an invalid project.");
  return {
    id: stringField(value, "id"),
    name: stringField(value, "name"),
    originUrl: nullableStringField(value, "originUrl"),
    storePath: stringField(value, "storePath"),
    defaultBranch: stringField(value, "defaultBranch"),
  };
};

const parseSessionStatus = (value: unknown): SessionStatus => {
  const status = SESSION_STATUSES.find((candidate) => candidate === value);
  if (status !== undefined) return status;
  throw new Error("Mend returned an invalid session status.");
};

const parseSession = (value: unknown): Session => {
  if (!isRecord(value)) throw new Error("Mend returned an invalid session.");
  return {
    id: stringField(value, "id"),
    projectId: stringField(value, "projectId"),
    harness: stringField(value, "harness"),
    label: nullableStringField(value, "label"),
    worktree: stringField(value, "worktree"),
    branch: stringField(value, "branch"),
    status: parseSessionStatus(value["status"]),
    // Tolerant: an older server omits the field; the workspace open then falls back.
    sealantWorkspaceId:
      typeof value["sealantWorkspaceId"] === "string" ? value["sealantWorkspaceId"] : null,
    createdAt: stringField(value, "createdAt"),
  };
};

const parseArray = <T>(
  value: unknown,
  parse: (item: unknown) => T,
  label: string,
): ReadonlyArray<T> => {
  if (!Array.isArray(value)) throw new Error(`Mend returned invalid ${label}.`);
  return value.map(parse);
};

const parseProjectDetail = (value: unknown): ProjectDetail => {
  if (!isRecord(value)) throw new Error("Mend returned an invalid project detail.");
  return {
    project: parseProject(value["project"]),
    sessions: parseArray(value["sessions"], parseSession, "sessions"),
  };
};

const responseMessage = (value: unknown, fallback: string): string => {
  if (!isRecord(value)) return fallback;
  const message = value["message"];
  return typeof message === "string" && message !== "" ? message : fallback;
};

export class MendApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "MendApiError";
  }
}

/** Small authenticated client for the extension's project and session jobs. */
export class MendClient {
  constructor(private readonly connections: ConnectionStore) {}

  async connection(): Promise<MendConnection> {
    return this.connections.get();
  }

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const connection = await this.connections.get();
    const headers = new Headers(init?.headers);
    headers.set("accept", "application/json");
    if (init?.body !== undefined) headers.set("content-type", "application/json");
    if (connection.token !== null) headers.set("authorization", `Bearer ${connection.token}`);
    let response: Response;
    try {
      response = await fetch(`${connection.url}/api${path}`, { ...init, headers });
    } catch (cause) {
      throw new MendApiError(
        `Cannot reach Mend at ${connection.url}.${cause instanceof Error ? ` ${cause.message}` : ""}`,
        null,
      );
    }
    const text = await response.text();
    let body: unknown = null;
    if (text !== "") {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    if (!response.ok) {
      throw new MendApiError(
        responseMessage(body, `Mend responded ${response.status}.`),
        response.status,
      );
    }
    return body;
  }

  private post(path: string, payload: unknown): Promise<unknown> {
    return this.request(path, { method: "POST", body: JSON.stringify(payload) });
  }

  async listProjects(): Promise<ReadonlyArray<Project>> {
    return parseArray(await this.request("/projects"), parseProject, "projects");
  }

  async projectDetail(id: string): Promise<ProjectDetail> {
    return parseProjectDetail(await this.request(`/projects/${encodeURIComponent(id)}`));
  }

  async resolveProject(facts: RepositoryFacts): Promise<ProjectResolution> {
    const projects = await this.listProjects();
    const normalizedOrigin = normalizeRemoteUrl(facts.originUrl);
    const byRemote =
      normalizedOrigin === null
        ? undefined
        : projects.find((project) => normalizeRemoteUrl(project.originUrl) === normalizedOrigin);
    if (byRemote !== undefined)
      return { status: "matched", project: byRemote, matchedBy: "origin" };

    const normalizedName = normalizeProjectName(facts.folder);
    const byName = projects.find((project) => project.name === normalizedName);
    if (byName !== undefined)
      return { status: "matched", project: byName, matchedBy: "folder-name" };

    const byPath = projects.filter((project) => {
      if (
        project.originUrl !== null &&
        normalizePath(project.originUrl) !== null &&
        sameOrInside(facts.path, project.originUrl)
      ) {
        return true;
      }
      const store = normalizePath(project.storePath);
      if (store === null) return false;
      const separator = store.lastIndexOf("/");
      return separator > 0 && sameOrInside(facts.path, store.slice(0, separator));
    });
    if (byPath.length === 1 && byPath[0] !== undefined) {
      return { status: "matched", project: byPath[0], matchedBy: "path" };
    }
    if (byPath.length > 1) return { status: "ambiguous", candidates: byPath, matchedBy: "path" };
    return { status: "not-found" };
  }

  async createSession(
    projectId: string,
    harness: string,
    label: string | null,
    base: string | null,
  ): Promise<Session> {
    return parseSession(
      await this.post(`/projects/${encodeURIComponent(projectId)}/sessions`, {
        harness,
        label,
        base,
      }),
    );
  }

  async launchSession(sessionId: string, start: LaunchStart): Promise<Session> {
    return parseSession(
      await this.post(`/sessions/${encodeURIComponent(sessionId)}/launch`, start),
    );
  }

  async stopSession(sessionId: string): Promise<Session> {
    return parseSession(await this.post(`/sessions/${encodeURIComponent(sessionId)}/stop`, {}));
  }

  /** Rejoin a settled session. `harness` "shell" opens the workbench without launching an agent. */
  async resumeSession(sessionId: string, harness: string | null): Promise<Session> {
    return parseSession(
      await this.post(`/sessions/${encodeURIComponent(sessionId)}/resume`, { harness }),
    );
  }

  async adoptProject(name: string, source: string): Promise<Project> {
    return parseProject(await this.post("/projects", { name, source }));
  }

  async findSession(
    sessionId: string,
  ): Promise<{ readonly project: Project; readonly session: Session } | null> {
    for (const project of await this.listProjects()) {
      const detail = await this.projectDetail(project.id);
      const session = detail.sessions.find((candidate) => candidate.id === sessionId);
      if (session !== undefined) return { project, session };
    }
    return null;
  }

  subscribe(onEvent: () => void): vscode.Disposable {
    const controller = new AbortController();
    void this.eventLoop(controller.signal, onEvent);
    return new vscode.Disposable(() => controller.abort());
  }

  private async eventLoop(signal: AbortSignal, onEvent: () => void): Promise<void> {
    let delay = 1_000;
    while (!signal.aborted) {
      try {
        const connection = await this.connections.get();
        const headers = new Headers({ accept: "text/event-stream" });
        if (connection.token !== null) headers.set("authorization", `Bearer ${connection.token}`);
        const response = await fetch(`${connection.url}/api/events`, { headers, signal });
        if (!response.ok || response.body === null)
          throw new Error(`events responded ${response.status}`);
        delay = 1_000;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const message = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            if (message.split("\n").some((line) => line.startsWith("data:"))) onEvent();
            boundary = buffer.indexOf("\n\n");
          }
        }
      } catch {
        if (signal.aborted) return;
      }
      await wait(delay, undefined, { signal }).catch(() => undefined);
      delay = Math.min(delay * 2, 15_000);
    }
  }
}

const normalizeRemoteUrl = (raw: string | null): string | null => {
  if (raw === null) return null;
  const trimmed = raw.trim();
  const scp = /^(?:[^@\s/]+@)?([^:/\s]+):(?!\/)(.+)$/.exec(trimmed);
  const url = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/\s:]+)(?::\d+)?\/(.+)$/i.exec(trimmed);
  const parts = url ?? scp;
  if (parts === null) return null;
  const host = parts[1];
  const rest = parts[2];
  if (host === undefined || rest === undefined) return null;
  return `${host.toLowerCase()}/${rest
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .toLowerCase()}`;
};

export const normalizeProjectName = (raw: string): string => {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+$/, "");
  return slug === "" ? "project" : slug.slice(0, 64);
};

const normalizePath = (value: string): string | null => {
  const trimmed = value.trim().replaceAll("\\", "/").replace(/\/+$/, "");
  return trimmed === "" || trimmed.includes("://") ? null : trimmed;
};

const sameOrInside = (candidate: string, root: string): boolean => {
  const normalizedCandidate = normalizePath(candidate);
  const normalizedRoot = normalizePath(root);
  return (
    normalizedCandidate !== null &&
    normalizedRoot !== null &&
    (normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`))
  );
};

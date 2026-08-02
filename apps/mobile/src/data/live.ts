/**
 * The live workbench API, adapted into the shapes the screens already render
 * (mock.ts defined the visual contract; this feeds it real sessions). Config
 * is a server URL + bearer token stored on device — same token the CLI uses.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { StatusTone } from "@/components/status";

// ─── config ─────────────────────────────────────────────────────────────────

export interface MendConfig {
  readonly url: string;
  readonly token: string;
}

let cached: MendConfig | null = null;

export const loadConfig = async (): Promise<MendConfig> => {
  if (cached !== null) return cached;
  const raw = await AsyncStorage.getItem("mend-config");
  cached = raw !== null ? (JSON.parse(raw) as MendConfig) : { url: "", token: "" };
  return cached;
};

export const saveConfig = async (config: MendConfig): Promise<void> => {
  cached = config;
  await AsyncStorage.setItem("mend-config", JSON.stringify(config));
};

// ─── wire types (the server's DTOs, minimally) ──────────────────────────────

export interface ProjectDto {
  readonly id: string;
  readonly name: string;
  readonly defaultBranch: string;
  readonly adoptedSha: string | null;
}

export interface SessionDto {
  readonly id: string;
  readonly projectId: string;
  readonly harness: string;
  readonly label: string | null;
  readonly branch: string;
  readonly baseSha: string;
  readonly status: string;
  readonly summary: string | null;
  readonly sealantRunId: string | null;
  readonly sealantSessionId: string | null;
  readonly settledAt: string | null;
  readonly startedAt: string | null;
  readonly createdAt: string;
}

export interface ChangedFileDto {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

/** The server answered and said no — carries its own words when it gave any. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const api = async <T>(method: "GET" | "POST", route: string, body?: unknown): Promise<T> => {
  const config = await loadConfig();
  if (config.url === "") throw new ApiError("Set the server URL in Settings first.", 0);
  const response = await fetch(`${config.url}/api${route}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.token}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    let message = `${method} ${route} → ${response.status}`;
    try {
      const parsed = (await response.json()) as { readonly message?: unknown };
      if (typeof parsed.message === "string" && parsed.message !== "") message = parsed.message;
    } catch {
      // Not JSON — the status line stands.
    }
    throw new ApiError(message, response.status);
  }
  return (await response.json()) as T;
};

// ─── queries ────────────────────────────────────────────────────────────────

export const ACTIVE = new Set(["starting", "running", "waiting", "idle"]);

export const toneOf = (status: string): StatusTone =>
  status === "completed"
    ? "observed"
    : status === "failed"
      ? "breakage"
      : status === "waiting" || status === "idle"
        ? "waiting"
        : ACTIVE.has(status)
          ? "live"
          : "pending";

/** Adapt a server session into the shape the skeleton's components render. */
export const toSession = (dto: SessionDto, projectName: string) => ({
  id: dto.id,
  runId: dto.sealantRunId ?? "",
  harness: (dto.harness === "claude"
    ? "Claude Code"
    : dto.harness === "codex"
      ? "Codex"
      : "OpenCode") as "Claude Code" | "Codex" | "OpenCode",
  projectId: projectName,
  title: dto.label ?? `session ${dto.id.slice(0, 8)}`,
  state: (ACTIVE.has(dto.status)
    ? dto.status === "waiting"
      ? "waiting"
      : "running"
    : dto.status === "completed"
      ? "completed"
      : dto.status === "failed"
        ? "failed"
        : "stopped") as "running" | "waiting" | "completed" | "failed" | "stopped",
  statusWord: dto.status,
  statusTone: toneOf(dto.status),
  startedAt: dto.startedAt ?? dto.createdAt,
  eventCount: 0,
  events: [],
});

export const useProjects = () =>
  useQuery({
    queryKey: ["projects"],
    queryFn: () => api<ReadonlyArray<ProjectDto>>("GET", "/projects"),
    refetchInterval: 15_000,
  });

export const useProjectSessions = (projectId: string | null) =>
  useQuery({
    queryKey: ["project", projectId],
    enabled: projectId !== null,
    queryFn: () =>
      api<{ readonly project: ProjectDto; readonly sessions: ReadonlyArray<SessionDto> }>(
        "GET",
        `/projects/${projectId}`,
      ),
    refetchInterval: 10_000,
  });

export const useAllSessions = () => {
  const projects = useProjects();
  return useQuery({
    queryKey: ["all-sessions", projects.data?.map((p) => p.id).join(",")],
    enabled: projects.data !== undefined,
    queryFn: async () => {
      const details = await Promise.all(
        (projects.data ?? []).map((project) =>
          api<{ readonly sessions: ReadonlyArray<SessionDto> }>(
            "GET",
            `/projects/${project.id}`,
          ).then((detail) => detail.sessions.map((s) => ({ session: s, project }))),
        ),
      );
      return details.flat();
    },
    refetchInterval: 8_000,
  });
};

export const useSession = (id: string) =>
  useQuery({
    queryKey: ["session", id],
    queryFn: () =>
      api<{
        readonly session: SessionDto;
        readonly checkpoints: ReadonlyArray<{ readonly sha: string; readonly trigger: string }>;
        readonly change: { readonly id: string } | null;
      }>("GET", `/sessions/${id}`),
    refetchInterval: 5_000,
  });

export const useChangeDiff = (changeId: string | null) =>
  useQuery({
    queryKey: ["change", changeId],
    enabled: changeId !== null,
    queryFn: () =>
      api<{
        readonly diff: string;
        readonly files: ReadonlyArray<ChangedFileDto>;
      }>("GET", `/changes/${changeId}/diff`),
  });

export interface TranscriptEventDto {
  readonly kind: string;
  readonly text: string | null;
  readonly name: string | null;
  readonly command: string | null;
  readonly output: string | null;
}

export const useTranscript = (sessionId: string, live: boolean) =>
  useQuery({
    queryKey: ["transcript", sessionId],
    queryFn: () =>
      api<{ readonly sourceHarness: string; readonly events: ReadonlyArray<TranscriptEventDto> }>(
        "GET",
        `/sessions/${sessionId}/transcript`,
      ),
    refetchInterval: live ? 1_500 : false,
  });

// ─── github discovery (the server host's own gh CLI answers) ────────────────

export interface GhStatusDto {
  readonly available: boolean;
  readonly authenticated: boolean;
  readonly login: string | null;
  readonly detail: string | null;
}

export interface GhRepoDto {
  readonly nameWithOwner: string;
  readonly description: string | null;
  readonly visibility: string;
  readonly isFork: boolean;
  readonly language: string | null;
  readonly stars: number;
  readonly pushedAt: string | null;
  readonly url: string;
}

export const useGhStatus = () =>
  useQuery({
    queryKey: ["github-status"],
    queryFn: () => api<GhStatusDto>("GET", "/github/status"),
    staleTime: 30_000,
    retry: false,
  });

export const useGhRepos = (query: string, enabled: boolean) =>
  useQuery({
    queryKey: ["github-repos", query],
    enabled,
    queryFn: () =>
      api<ReadonlyArray<GhRepoDto>>(
        "GET",
        query === "" ? "/github/repos" : `/github/repos?query=${encodeURIComponent(query)}`,
      ),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

// ─── actions ────────────────────────────────────────────────────────────────

/** How long to keep watching for a clone whose request dropped mid-flight. */
const ADOPT_WATCH_MS = 180_000;
const ADOPT_POLL_MS = 3_000;

export const useAdoptProject = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { readonly name: string; readonly source: string }) => {
      try {
        return await api<ProjectDto>("POST", "/projects", input);
      } catch (error) {
        // A big clone can outlive the phone's request while the server keeps
        // cloning. Only on a dropped connection (never on an answered
        // failure), watch the project list for the name instead of failing
        // blind.
        if (!(error instanceof TypeError)) throw error;
        const startedAt = Date.now();
        while (Date.now() - startedAt < ADOPT_WATCH_MS) {
          await new Promise((resolve) => setTimeout(resolve, ADOPT_POLL_MS));
          const projects = await api<ReadonlyArray<ProjectDto>>("GET", "/projects").catch(
            () => null,
          );
          const adopted = projects?.find((project) => project.name === input.name);
          if (adopted !== undefined) return adopted;
        }
        throw new Error(
          `The connection dropped mid-clone and "${input.name}" has not appeared after 3 minutes — check the server.`,
          { cause: error },
        );
      }
    },
    onSettled: () => queryClient.invalidateQueries(),
  });
};

export const useSessionActions = () => {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries();
  const start = useMutation({
    mutationFn: async (input: { readonly projectId: string; readonly harness: string }) => {
      const session = await api<SessionDto>("POST", `/projects/${input.projectId}/sessions`, {
        harness: input.harness,
        label: null,
        base: null,
      });
      // Fire-and-forget: the server settles the session if provisioning fails.
      void api("POST", `/sessions/${session.id}/launch`, { argv: [input.harness] }).catch(
        () => undefined,
      );
      return session;
    },
    onSettled: invalidate,
  });
  const resume = useMutation({
    mutationFn: (input: { readonly sessionId: string; readonly harness: string | null }) =>
      api<SessionDto>("POST", `/sessions/${input.sessionId}/resume`, { harness: input.harness }),
    onSettled: invalidate,
  });
  const stop = useMutation({
    mutationFn: (sessionId: string) => api<SessionDto>("POST", `/sessions/${sessionId}/stop`, {}),
    onSettled: invalidate,
  });
  return { start, resume, stop };
};

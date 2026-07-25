/**
 * The live workbench API, adapted into the shapes the screens already render
 * (mock.ts defined the visual contract; this feeds it real sessions). Config
 * is a server URL + bearer token stored on device — same token the CLI uses.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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

const api = async <T>(method: "GET" | "POST", route: string, body?: unknown): Promise<T> => {
  const config = await loadConfig();
  if (config.url === "") throw new Error("Set the server URL in Settings first.");
  const response = await fetch(`${config.url}/api${route}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.token}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`${method} ${route} → ${response.status}`);
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
  title: dto.label ?? dto.branch.replace(/^mend\/session\//, "session "),
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

// ─── actions ────────────────────────────────────────────────────────────────

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

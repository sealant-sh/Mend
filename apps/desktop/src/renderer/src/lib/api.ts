/**
 * The workbench API as the cockpit reads it. Wire shapes are the server's
 * DTOs, minimally (the authoritative schemas live in @mend/api's contract —
 * the client reads, it does not re-validate). Every call rides the preload
 * bridge: main holds the URL and the bearer, this module holds the paths.
 */

export type SessionStatusDto =
  | "starting"
  | "running"
  | "waiting"
  | "idle"
  | "completed"
  | "failed"
  | "stopped";

export const LIVE_STATUSES: ReadonlySet<SessionStatusDto> = new Set([
  "starting",
  "running",
  "waiting",
  "idle",
]);

/** Only what the client needs: the login shell a family image bakes. */
export interface WorkspaceImageDto {
  readonly mode: string;
  readonly shell?: string;
}

export interface ProjectDto {
  readonly id: string;
  readonly name: string;
  readonly originUrl: string | null;
  readonly storePath: string;
  readonly defaultBranch: string;
  readonly adoptedSha: string | null;
  readonly workspaceImage: WorkspaceImageDto | null;
  readonly createdAt: string;
}

export interface SessionDto {
  readonly id: string;
  readonly projectId: string;
  readonly harness: string;
  readonly label: string | null;
  readonly worktree: string;
  readonly branch: string;
  readonly baseSha: string;
  readonly sealantRunId: string | null;
  readonly sealantSessionId: string | null;
  readonly status: SessionStatusDto;
  readonly summary: string | null;
  readonly startedAt: string | null;
  readonly settledAt: string | null;
  readonly createdAt: string;
}

/** List decoration for one session — DB-cheap review facts, no git involved. */
export interface SessionAnnotationDto {
  readonly sessionId: string;
  readonly changeId: string | null;
  readonly openComments: number;
  readonly totalComments: number;
  readonly pendingFollowUp: boolean;
}

export interface ProjectDetailDto {
  readonly project: ProjectDto;
  readonly sessions: ReadonlyArray<SessionDto>;
  readonly annotations: ReadonlyArray<SessionAnnotationDto>;
}

export interface CheckpointDto {
  readonly id: string;
  readonly sessionId: string;
  readonly ref: string;
  readonly sha: string;
  /** Record sequence at the checkpoint — bigint on the wire, string here. */
  readonly seq: string;
  readonly trigger: string;
  readonly createdAt: string;
}

export interface SessionChangeDto {
  readonly id: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly branch: string;
  readonly baseSha: string;
  readonly headSha: string | null;
}

export interface SessionDetailDto {
  readonly session: SessionDto;
  readonly checkpoints: ReadonlyArray<CheckpointDto>;
  readonly change: SessionChangeDto | null;
}

export type SessionProcessKind = "agent" | "shell" | "service";

/** Observed lifecycle only — never a judgment about the work. */
export type SessionProcessStatus =
  | "starting"
  | "running"
  | "reachable"
  | "unreachable"
  | "exited"
  | "stopped";

/** One workspace process — agent, shell, or Service (docs/SESSION-SERVICES.md). */
export interface SessionProcessDto {
  readonly id: string;
  readonly sessionId: string;
  readonly kind: SessionProcessKind;
  readonly label: string | null;
  readonly argv: ReadonlyArray<string>;
  readonly status: SessionProcessStatus;
  readonly exitCode: number | null;
  readonly workspacePort: number | null;
  readonly protocol: "tcp" | "udp";
  readonly hostPort: number | null;
  readonly exitedAt: string | null;
}

export const LIVE_PROCESS: ReadonlySet<SessionProcessStatus> = new Set([
  "starting",
  "running",
  "reachable",
  "unreachable",
]);

// ─── transport ──────────────────────────────────────────────────────────────

/** The server answered and said no — carries its own words when it gave any. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const isUnauthorized = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 401;

const describe = (body: unknown): string | null => {
  if (typeof body === "string" && body !== "") return body;
  if (typeof body === "object" && body !== null) {
    const record = body as { readonly message?: unknown; readonly error?: unknown };
    if (typeof record.message === "string") return record.message;
    if (typeof record.error === "string") return record.error;
  }
  return null;
};

const request = async <A>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<A> => {
  const response = await window.mend.api.request(
    body === undefined ? { method, path } : { method, path, body },
  );
  if (!response.ok) {
    const detail = describe(response.body);
    throw new ApiError(
      response.status === 0
        ? (detail ?? "the Mend server did not answer")
        : `${method} ${path} responded ${response.status}${detail === null ? "" : ` — ${detail}`}`,
      response.status,
    );
  }
  // The bridge returns the decoded JSON; the DTO type is this module's claim.
  return response.body as A;
};

const get = <A>(path: string) => request<A>("GET", path);
const post = <A>(path: string, body: unknown) => request<A>("POST", path, body);

// ─── reads ──────────────────────────────────────────────────────────────────

export const listProjects = () => get<ReadonlyArray<ProjectDto>>("/api/projects");

export const projectDetail = (id: string) => get<ProjectDetailDto>(`/api/projects/${id}`);

export const sessionDetail = (id: string) => get<SessionDetailDto>(`/api/sessions/${id}`);

export const listSessionProcesses = (id: string) =>
  get<ReadonlyArray<SessionProcessDto>>(`/api/sessions/${id}/processes`);

// ─── writes ─────────────────────────────────────────────────────────────────

export const createSession = (projectId: string, harness: string, label: string | null) =>
  post<SessionDto>(`/api/projects/${projectId}/sessions`, { harness, label, base: null });

/** Launch runs `argv` supervised in the session's fresh workspace. */
export const launchSession = (id: string, argv: ReadonlyArray<string>) =>
  post<SessionDto>(`/api/sessions/${id}/launch`, { argv });

/** The opening argv per harness — the same table the CLI uses. */
export const launchArgv = (harness: string): ReadonlyArray<string> =>
  harness === "codex"
    ? ["codex"]
    : harness === "claude"
      ? ["claude"]
      : harness === "opencode"
        ? ["opencode"]
        : harness === "shell"
          ? ["bash", "-l"]
          : [harness];

export const checkpointSession = (id: string, trigger: "review-open" | "user-mark") =>
  post<CheckpointDto>(`/api/sessions/${id}/checkpoints`, { trigger });

/** The second pane: a real shell in the session's live workspace. */
export const openShell = (id: string) => post<SessionProcessDto>(`/api/sessions/${id}/shell`, {});

export const stopSession = (id: string) => post<SessionDto>(`/api/sessions/${id}/stop`, {});

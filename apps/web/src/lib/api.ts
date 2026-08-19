import { redirect } from "@tanstack/react-router";

/**
 * Wire shapes for the M1 surface, as JSON delivers them (dates are ISO
 * strings). The authoritative schemas live in @mend/api's contract; these
 * stay deliberately small — the client reads, it does not re-validate.
 */

export type IssueStage = "triage" | "queued" | "mending" | "review" | "merged";

export interface IssueDto {
  readonly id: string;
  readonly source: "manual" | "github" | "linear" | "jira";
  readonly externalRef: string | null;
  readonly repository: string;
  readonly title: string;
  readonly body: string;
  readonly stage: IssueStage;
  readonly position: number | null;
  readonly lastFailureRunId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

/** The failure mini-brief: what was tried · what was observed · reproduction status. */
export interface FailureBriefDto {
  readonly whatWasTried: string;
  readonly whatWasObserved: string;
  readonly reproductionStatus: string;
  readonly evidence: ReadonlyArray<EvidencePointerDto>;
}

export interface RunDto {
  readonly id: string;
  readonly issueId: string;
  readonly kind: "initial" | "follow-up" | "verification";
  readonly status: RunStatus;
  readonly outcome: "completed" | "failed" | null;
  readonly summary: string | null;
  readonly failureBrief: FailureBriefDto | null;
  readonly sealantRunId: string | null;
  readonly startedAt: string | null;
  readonly settledAt: string | null;
  readonly createdAt: string;
}

export interface IssueDetailDto {
  readonly issue: IssueDto;
  readonly runs: ReadonlyArray<RunDto>;
}

export interface RunCommandDto {
  readonly command: string;
  readonly exitCode: number | null;
  readonly durationMs: number | null;
}

export interface LossReportDto {
  readonly complete: boolean;
  readonly spans: ReadonlyArray<{
    readonly fromSequence: string | null;
    readonly toSequence: string | null;
  }>;
}

export interface RunDetailDto {
  readonly run: RunDto;
  readonly commands: ReadonlyArray<RunCommandDto>;
  readonly transcript: string | null;
  readonly loss: LossReportDto | null;
  readonly recordError: string | null;
}

export interface TraceEntryDto {
  readonly sequence: string;
  readonly occurredAt: string;
  readonly kind: string;
  readonly summary: string;
  readonly processId: string | null;
}

export interface TracePageDto {
  readonly entries: ReadonlyArray<TraceEntryDto>;
  readonly nextFrom: string | null;
}

export interface RunSourceDto {
  readonly host: string;
  readonly method: string | null;
  readonly path: string | null;
  readonly status: number | null;
  readonly count: number;
  readonly firstSequence: string;
}

export interface SealantConnectionDto {
  readonly status: "connected" | "unauthorized" | "mismatched" | "unreachable";
  readonly baseUrl: string;
  readonly detail: string | null;
  readonly checkedAt: string;
}

/** The SSE payloads from /api/events — pointers, never data. */
export type MendEventDto =
  | { readonly type: "issue"; readonly issueId: string }
  | { readonly type: "run"; readonly runId: string; readonly issueId: string }
  | {
      readonly type: "run-progress";
      readonly runId: string;
      readonly issueId: string;
      readonly sequence: string;
      readonly line: string;
    }
  | { readonly type: "brief"; readonly changeId: string; readonly issueId: string }
  | { readonly type: "brief-comment"; readonly briefId: string; readonly issueId: string };

// ─── The brief (M2): sequences ride the wire as decimal strings ─────────────

export type DispositionDto = "direct-evidence" | "not-executed" | "unrelated-change";

export interface EvidencePointerDto {
  readonly runId: string;
  readonly sequence: string;
  readonly excerpt: string;
}

export interface BriefQuestionDto {
  readonly index: number;
  readonly question: string;
  readonly disposition: DispositionDto;
  readonly evidence: ReadonlyArray<EvidencePointerDto>;
}

export interface BriefCalloutDto {
  readonly severity: "not-executed" | "unrelated-change";
  readonly text: string;
  readonly evidence: ReadonlyArray<EvidencePointerDto>;
}

export interface BriefEvidenceSourceDto {
  readonly source: string;
  readonly established: string;
  readonly pointers: ReadonlyArray<EvidencePointerDto>;
}

export interface BriefDocumentDto {
  readonly header: {
    readonly repository: string;
    readonly prRef: string | null;
    readonly issueRef: string;
    readonly checksCount: number | null;
    readonly headSha: string | null;
    readonly freshness: "current" | "stale";
  };
  readonly causalProof: {
    readonly baseFails: EvidencePointerDto | null;
    readonly headPasses: EvidencePointerDto | null;
    readonly revertFails: EvidencePointerDto | null;
  };
  readonly issueRestated: string;
  readonly reproduction: string | null;
  readonly whatWasDone: string;
  readonly statusNow: string;
  readonly monoFacts: string;
  readonly questions: ReadonlyArray<BriefQuestionDto>;
  readonly attention: ReadonlyArray<BriefCalloutDto>;
  readonly evidenceUsed: ReadonlyArray<BriefEvidenceSourceDto>;
}

export interface BriefDto {
  readonly id: string;
  readonly changeId: string;
  readonly currentVersion: number;
  readonly document: BriefDocumentDto;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ChangeDto {
  readonly id: string;
  readonly issueId: string;
  readonly branch: string;
  readonly baseSha: string | null;
  readonly headSha: string | null;
  readonly prNumber: number | null;
  readonly prUrl: string | null;
  readonly freshness: "current" | "stale";
}

export interface BriefDetailDto {
  readonly brief: BriefDto;
  readonly change: ChangeDto;
}

export type RoutedActionDto = "follow-up-run" | "verification-run" | "question-back";

export interface BriefCommentDto {
  readonly id: string;
  readonly briefId: string;
  readonly thread: string;
  readonly authorKind: "reviewer" | "mend";
  readonly authorName: string;
  readonly body: string;
  readonly routedAction: RoutedActionDto | null;
  readonly routedRunId: string | null;
  readonly createdAt: string;
}

export interface BriefVersionDto {
  readonly briefId: string;
  readonly version: number;
  readonly document: BriefDocumentDto;
  readonly createdAt: string;
}

async function request<A>(path: string, init?: RequestInit): Promise<A> {
  const response = await fetch(path, { credentials: "include", ...init });
  if (response.status === 401) throw redirect({ to: "/login" });
  if (!response.ok)
    throw new Error(`${init?.method ?? "GET"} ${path} responded ${response.status}`);
  const body: A = await response.json();
  return body;
}

const post = <A>(path: string, payload: unknown) =>
  request<A>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

export const listIssues = () => request<ReadonlyArray<IssueDto>>("/api/issues");

export const issueDetail = (id: string) => request<IssueDetailDto>(`/api/issues/${id}`);

export const runDetail = (id: string) => request<RunDetailDto>(`/api/runs/${id}`);

/** One page of the full trace; pass `from` to resume where the last page ended. */
export const runTrace = (id: string, from?: string) =>
  request<TracePageDto>(`/api/runs/${id}/trace${from === undefined ? "" : `?from=${from}`}`);

export const runSources = (id: string) =>
  request<ReadonlyArray<RunSourceDto>>(`/api/runs/${id}/sources`);

/** The issue's living brief — null while no brief exists yet (404 is a state, not an error). */
export const briefByIssue = async (issueId: string): Promise<BriefDetailDto | null> => {
  const response = await fetch(`/api/issues/${issueId}/brief`, { credentials: "include" });
  if (response.status === 401) throw redirect({ to: "/login" });
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`GET /api/issues/${issueId}/brief responded ${response.status}`);
  const body: BriefDetailDto = await response.json();
  return body;
};

export const listBriefComments = (issueId: string) =>
  request<ReadonlyArray<BriefCommentDto>>(`/api/issues/${issueId}/brief/comments`);

/** Posting a comment is Gate-free — Mend reads it and routes the next action. */
export const postBriefComment = (issueId: string, thread: string, body: string) =>
  post<BriefCommentDto>(`/api/issues/${issueId}/brief/comments`, { thread, body });

export const briefVersions = (issueId: string) =>
  request<ReadonlyArray<BriefVersionDto>>(`/api/issues/${issueId}/brief/versions`);

export const createIssue = (input: {
  readonly repository: string;
  readonly title: string;
  readonly body: string;
}) => post<IssueDto>("/api/issues", { source: "manual", externalRef: null, ...input });

/** Gate 1 — the drag. `position` is the target index within queued; null appends. */
export const moveIssue = (id: string, stage: "triage" | "queued", position: number | null) =>
  post<IssueDto>(`/api/issues/${id}/move`, { stage, position });

export const sealantConnection = () => request<SealantConnectionDto>("/api/sealant/connection");

// ─── Workbench (MEND-AGENT-WORKBENCH-PLAN.md §5–§7) ─────────────────────────

export type SessionStatusDto =
  | "starting"
  | "running"
  | "waiting"
  | "idle"
  | "completed"
  | "failed"
  | "stopped";

/** A project's stance on one review-automation switch; inherit follows Settings. */
export type AutomationChoiceDto = "inherit" | "on" | "off";

/** How host-side git reaches the project's remote (docs/GIT-ACCESS.md). */
export type GitAuthModeDto = "ambient" | "mend-key" | "bridge";

export interface ProjectDto {
  readonly id: string;
  readonly name: string;
  readonly originUrl: string | null;
  readonly storePath: string;
  readonly defaultBranch: string;
  readonly adoptedSha: string | null;
  readonly autoTour: AutomationChoiceDto;
  readonly autoSuggest: AutomationChoiceDto;
  readonly gitAuthMode: GitAuthModeDto;
  readonly workspaceImage: WorkspaceImageDto | null;
  readonly applyDotfiles: boolean;
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

/** Diff stats without the diff — cheap enough for a visible list row. */
export interface ChangeStatsDto {
  readonly files: number;
  readonly additions: number;
  readonly deletions: number;
}

export const changeStats = (id: string) => request<ChangeStatsDto>(`/api/changes/${id}/stats`);

/** The outcome of a destructive removal — what went, what would not delete. */
export interface RemovalReportDto {
  readonly removed: boolean;
  readonly leftover: string | null;
}

const del = <A>(path: string) => request<A>(path, { method: "DELETE" });

/** Stops live sessions, deletes every row under the project, removes the store copy. */
export const removeProject = (id: string) => del<RemovalReportDto>(`/api/projects/${id}`);

/** Settled sessions only — a live one answers 409. Takes the worktree with it. */
export const removeSession = (id: string) => del<RemovalReportDto>(`/api/sessions/${id}`);

export const setSessionLabel = (id: string, label: string | null) =>
  post<SessionDto>(`/api/sessions/${id}/label`, { label });

export interface CheckpointDto {
  readonly id: string;
  readonly sessionId: string;
  readonly ref: string;
  readonly sha: string;
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

export interface ChangedFileDto {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

export interface ChangeDiffDto {
  readonly change: SessionChangeDto;
  readonly diff: string;
  readonly files: ReadonlyArray<ChangedFileDto>;
}

/** A finding's link into the session record; sequence is a decimal string. */
export interface RecordLinkDto {
  readonly sealantRunId: string;
  readonly sequence: string;
  readonly excerpt: string;
}

export interface ReviewCommentDto {
  readonly id: string;
  readonly changeId: string;
  readonly file: string | null;
  readonly line: number | null;
  readonly endLine: number | null;
  readonly authorKind: "reviewer" | "mend";
  readonly authorName: string;
  readonly body: string;
  /** `suggestion` carries a concrete replacement for the anchored lines. */
  readonly kind: "note" | "suggestion";
  readonly suggestion: string | null;
  readonly state: "draft" | "open" | "addressed" | "dismissed";
  readonly evidence: ReadonlyArray<RecordLinkDto>;
  readonly sentToSessionId: string | null;
  readonly createdAt: string;
}

/** Queue the machine pass; findings arrive as draft comments over SSE. */
export const readChange = (changeId: string) =>
  post<{ readonly queued: boolean }>(`/api/changes/${changeId}/read`, {});

/** One stop of the composed review tour. */
export interface TourStopDto {
  readonly title: string;
  readonly file: string | null;
  readonly line: number | null;
  readonly endLine: number | null;
  readonly narration: string;
  readonly evidence: ReadonlyArray<RecordLinkDto>;
  readonly grounded: boolean;
}

/** Mend's composed guided walkthrough of a change. */
export interface ChangeTourDto {
  readonly id: string;
  readonly changeId: string;
  readonly sessionId: string;
  readonly summary: string;
  readonly approach: string | null;
  readonly stops: ReadonlyArray<TourStopDto>;
  readonly diffDigest: string;
  readonly createdAt: string;
}

export const changeTour = (changeId: string) =>
  request<ChangeTourDto | null>(`/api/changes/${changeId}/tour`);

/** Queue tour composition; the tour arrives over SSE when written. */
export const composeTour = (changeId: string) =>
  post<{ readonly queued: boolean }>(`/api/changes/${changeId}/tour`, {});

/** Queue the suggestion pass; suggestions land as draft comments over SSE. */
export const suggestChange = (changeId: string) =>
  post<{ readonly queued: boolean }>(`/api/changes/${changeId}/suggest`, {});

/**
 * A machine pass's recorded outcome: what ran over this change and what came
 * of it. Zero findings on a completed pass is an outcome, not an absence.
 */
export interface ChangePassDto {
  readonly changeId: string;
  readonly kind: "tour" | "read" | "suggest";
  readonly status: "running" | "completed" | "failed";
  readonly detail: string | null;
  readonly findings: number | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
}

export const changePasses = (changeId: string) =>
  request<ReadonlyArray<ChangePassDto>>(`/api/changes/${changeId}/passes`);

/** The workspace image: a managed OS family, or a custom base with exactly three knobs. */
export type WorkspaceImageDto =
  | {
      readonly mode: "family";
      readonly os: "fedora" | "arch" | "nix" | "ubuntu";
      readonly packages: ReadonlyArray<string>;
      readonly shell: "bash" | "zsh" | "fish";
      readonly services: { readonly docker: boolean };
    }
  | {
      readonly mode: "custom";
      readonly baseImage: string;
      readonly packages: ReadonlyArray<string>;
      readonly setupCommands: ReadonlyArray<string>;
      readonly services: { readonly docker: boolean };
    };

/** The user's dotfiles repository knob — cloned by the server at every launch. */
export interface DotfilesRepositoryDto {
  readonly url: string;
  readonly ref: string | null;
  /** Null archives the repo root; otherwise the archive is re-rooted at this directory. */
  readonly subdirectory: string | null;
  readonly manager: "auto" | "chezmoi" | "stow" | "copy";
  readonly bootstrap: boolean;
}

/** The current snapshot in the user's dotfiles store — an exact commit, source machine recorded. */
export interface DotfilesSnapshotDto {
  readonly sha: string;
  readonly source: string;
  readonly committedAt: string;
  readonly files: ReadonlyArray<{ readonly path: string; readonly bytes: number }>;
}

/** The current user's dotfiles. Per-account: dotfiles are identity, not instance settings. */
export interface DotfilesDto {
  readonly repository: DotfilesRepositoryDto | null;
  readonly snapshot: DotfilesSnapshotDto | null;
}

/** Product settings, one document; PUT replaces it (edit what GET returned). */
export interface SettingsDto {
  readonly prMode: "draft-immediately" | "pr-on-approval";
  readonly concurrency: number;
  readonly autoTour: boolean;
  readonly autoSuggest: boolean;
  readonly workspaceImage: WorkspaceImageDto;
}

export interface WorkspacePackageResolutionDto {
  readonly requested: string;
  readonly normalized: string;
  readonly status: "resolved" | "ambiguous" | "unsupported" | "not-found" | "invalid";
  readonly canonicalId: string | null;
  readonly supported: boolean;
  readonly packageName: string | null;
  readonly alternatives: ReadonlyArray<string>;
}

export interface WorkspaceEnvironmentSaveResultDto {
  readonly saved: boolean;
  readonly settings: SettingsDto;
  readonly resolutions: ReadonlyArray<WorkspacePackageResolutionDto>;
}

export interface HostEnvironmentSuggestionsDto {
  readonly tools: ReadonlyArray<{
    readonly executable: string;
    readonly kind: "package" | "service";
    readonly id: string;
  }>;
  readonly configs: ReadonlyArray<{ readonly label: string; readonly path: string }>;
}

export const getSettings = () => request<SettingsDto>("/api/settings");

export const putSettings = (settings: SettingsDto) =>
  request<SettingsDto>("/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(settings),
  });

export const saveWorkspaceEnvironment = (workspaceImage: SettingsDto["workspaceImage"]) =>
  request<WorkspaceEnvironmentSaveResultDto>("/api/settings/workspace-environment", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(workspaceImage),
  });

export const scanHostEnvironment = () =>
  request<HostEnvironmentSuggestionsDto>("/api/settings/environment-suggestions");

export const getDotfiles = () => request<DotfilesDto>("/api/dotfiles");

export const putDotfilesRepository = (repository: DotfilesRepositoryDto | null) =>
  request<DotfilesDto>("/api/dotfiles/repository", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repository }),
  });

export const postDotfilesSnapshot = (payload: {
  readonly files: ReadonlyArray<{
    readonly path: string;
    readonly contentsBase64: string;
  }>;
  readonly source: string;
  readonly merge: boolean;
}) =>
  request<DotfilesDto>("/api/dotfiles/snapshot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

export const deleteDotfilesSnapshot = () =>
  request<DotfilesDto>("/api/dotfiles/snapshot", { method: "DELETE" });

/** The project's automation overrides, replaced together. */
export const setProjectAutomation = (
  projectId: string,
  choices: { readonly autoTour: AutomationChoiceDto; readonly autoSuggest: AutomationChoiceDto },
) =>
  request<ProjectDto>(`/api/projects/${projectId}/automation`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(choices),
  });

export interface ProjectWorkspaceImageSaveResultDto {
  readonly saved: boolean;
  readonly project: ProjectDto | null;
  readonly resolutions: ReadonlyArray<WorkspacePackageResolutionDto>;
}

/** The project's workspace-image override; null returns it to the Settings default. */
export const setProjectWorkspaceImage = (
  projectId: string,
  workspaceImage: WorkspaceImageDto | null,
) =>
  request<ProjectWorkspaceImageSaveResultDto>(`/api/projects/${projectId}/workspace-image`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceImage }),
  });

/** Whether sessions in this project receive the launching user's dotfiles. */
export const setProjectApplyDotfiles = (projectId: string, applyDotfiles: boolean) =>
  request<ProjectDto>(`/api/projects/${projectId}/apply-dotfiles`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ applyDotfiles }),
  });

/** A workbench SSE event — pointers only; clients re-read through the API. */
export interface WorkbenchEventDto {
  readonly type: string;
  readonly projectId?: string;
  readonly sessionId?: string;
  readonly changeId?: string;
  readonly sequence?: string;
  readonly line?: string;
}

export const listProjects = () => request<ReadonlyArray<ProjectDto>>("/api/projects");

export const projectDetail = (id: string) => request<ProjectDetailDto>(`/api/projects/${id}`);

/** Adoption can fail for reasons worth reading (422 carries git's own words). */
export const adoptProject = async (
  name: string,
  source: string,
  gitAuthMode?: GitAuthModeDto,
): Promise<ProjectDto> => {
  const response = await fetch("/api/projects", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, source, ...(gitAuthMode === undefined ? {} : { gitAuthMode }) }),
  });
  if (response.status === 401) throw redirect({ to: "/login" });
  if (!response.ok) {
    const body: { readonly message?: string } = await response.json().catch(() => ({}));
    throw new Error(body.message ?? `adoption failed (${response.status})`);
  }
  const body: ProjectDto = await response.json();
  return body;
};

/** Switching to mend-key can fail readably (keygen refused on the host). */
export const setProjectGitAuth = async (
  projectId: string,
  gitAuthMode: GitAuthModeDto,
): Promise<ProjectDto> => {
  const response = await fetch(`/api/projects/${projectId}/git-auth`, {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gitAuthMode }),
  });
  if (response.status === 401) throw redirect({ to: "/login" });
  if (!response.ok) {
    const body: { readonly message?: string } = await response.json().catch(() => ({}));
    throw new Error(body.message ?? `git auth change failed (${response.status})`);
  }
  const body: ProjectDto = await response.json();
  return body;
};

/** The machine's Mend deploy key — public half only; the server never sends more. */
export interface GitKeyDto {
  readonly exists: boolean;
  readonly publicKey: string | null;
  readonly fingerprint: string | null;
}

export const gitKey = () => request<GitKeyDto>("/api/keys/git");

/** The ssh-agent bridge as observed right now — presence, not a verdict. */
export interface GitBridgeStatusDto {
  readonly connected: boolean;
  readonly clientName: string | null;
  readonly since: string | null;
}

export const gitBridgeStatus = () => request<GitBridgeStatusDto>("/api/keys/bridge");

/** Generate the machine key if missing; failure carries ssh-keygen's words. */
export const initGitKey = async (): Promise<GitKeyDto> => {
  const response = await fetch("/api/keys/git", { method: "POST", credentials: "include" });
  if (response.status === 401) throw redirect({ to: "/login" });
  if (!response.ok) {
    const body: { readonly message?: string } = await response.json().catch(() => ({}));
    throw new Error(body.message ?? `key generation failed (${response.status})`);
  }
  const body: GitKeyDto = await response.json();
  return body;
};

export interface ReferenceDto {
  readonly id: string;
  readonly name: string;
  readonly originUrl: string;
  readonly path: string;
  readonly pinnedRef: string | null;
  readonly headSha: string | null;
  readonly refreshedAt: string | null;
  readonly createdAt: string;
}

export const listReferences = () => request<ReadonlyArray<ReferenceDto>>("/api/references");

/** Cloning can fail for reasons worth reading (422 carries git's own words). */
export const addReference = async (
  name: string,
  source: string,
  ref: string | null,
): Promise<ReferenceDto> => {
  const response = await fetch("/api/references", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, source, ref }),
  });
  if (response.status === 401) throw redirect({ to: "/login" });
  if (!response.ok) {
    const body: { readonly message?: string } = await response.json().catch(() => ({}));
    throw new Error(body.message ?? `clone failed (${response.status})`);
  }
  const body: ReferenceDto = await response.json();
  return body;
};

/** 204 on success — no body to parse. */
export const removeReference = async (id: string): Promise<void> => {
  const response = await fetch(`/api/references/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (response.status === 401) throw redirect({ to: "/login" });
  if (!response.ok) throw new Error(`DELETE /api/references/${id} responded ${response.status}`);
};

export const refreshReference = (id: string) =>
  post<ReferenceDto>(`/api/references/${id}/refresh`, {});

export const projectReferences = (projectId: string) =>
  request<ReadonlyArray<ReferenceDto>>(`/api/projects/${projectId}/references`);

/** Replace the project's selection as a set — what its next sessions will mount. */
export const selectProjectReferences = (projectId: string, referenceIds: ReadonlyArray<string>) =>
  request<ReadonlyArray<ReferenceDto>>(`/api/projects/${projectId}/references`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ referenceIds }),
  });

export interface ProjectMountDto {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly hostPath: string;
  readonly readOnly: boolean;
  readonly createdAt: string;
}

export const projectMounts = (projectId: string) =>
  request<ReadonlyArray<ProjectMountDto>>(`/api/projects/${projectId}/mounts`);

/** Declaring a mount can fail for reasons worth reading (422 carries the check that refused). */
export const addProjectMount = async (
  projectId: string,
  input: { readonly name: string; readonly hostPath: string; readonly readOnly: boolean },
): Promise<ProjectMountDto> => {
  const response = await fetch(`/api/projects/${projectId}/mounts`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (response.status === 401) throw redirect({ to: "/login" });
  if (!response.ok) {
    const body: { readonly message?: string } = await response.json().catch(() => ({}));
    throw new Error(body.message ?? `mount failed (${response.status})`);
  }
  const body: ProjectMountDto = await response.json();
  return body;
};

/** 204 on success — no body to parse. */
export const removeProjectMount = async (projectId: string, mountId: string): Promise<void> => {
  const response = await fetch(`/api/projects/${projectId}/mounts/${mountId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (response.status === 401) throw redirect({ to: "/login" });
  if (!response.ok) throw new Error(`DELETE mount ${mountId} responded ${response.status}`);
};

export const listActiveSessions = () => request<ReadonlyArray<SessionDto>>("/api/sessions");

export const sessionDetail = (id: string) => request<SessionDetailDto>(`/api/sessions/${id}`);

export const createSession = (projectId: string, harness: string) =>
  post<SessionDto>(`/api/projects/${projectId}/sessions`, { harness, label: null, base: null });

/** Fire the supervised launch. Resolves when the workspace is ready (a first launch can take minutes). */
export const launchSession = (id: string, argv: ReadonlyArray<string>) =>
  post<SessionDto>(`/api/sessions/${id}/launch`, { argv });

export const stopSession = (id: string) => post<SessionDto>(`/api/sessions/${id}/stop`, {});

/** Rejoin a settled session; harness null = the one it last ran with. */
export const resumeSession = (id: string, harness: string | null) =>
  post<SessionDto>(`/api/sessions/${id}/resume`, { harness });

export const checkpointSession = (id: string, trigger: "review-open" | "user-mark") =>
  post<CheckpointDto>(`/api/sessions/${id}/checkpoints`, { trigger });

export const changeDiff = (id: string) => request<ChangeDiffDto>(`/api/changes/${id}/diff`);

/** One workspace process — agent, shell, or Service (docs/SESSION-SERVICES.md). */
export interface SessionProcessDto {
  readonly id: string;
  readonly sessionId: string;
  readonly kind: string;
  readonly label: string | null;
  readonly argv: ReadonlyArray<string>;
  readonly status: string;
  readonly exitCode: number | null;
  readonly workspacePort: number | null;
  readonly protocol: "tcp" | "udp";
  readonly hostPort: number | null;
  readonly exitedAt: string | null;
}

/** A declared Service recipe from the worktree's mend.toml. */
export interface ServiceRecipeDto {
  readonly name: string;
  readonly command: string | null;
  readonly port: number;
  readonly protocol: "tcp" | "udp";
  /** "file" = the repo's mend.toml (read-only here); "project" = declared on this machine. */
  readonly source: "file" | "project";
}

export const projectRecipes = (projectId: string) =>
  request<ReadonlyArray<ServiceRecipeDto>>(`/api/projects/${projectId}/service-recipes`);

/** Declaring can be refused for readable reasons (name taken, bad port) — surface them. */
export const addProjectRecipe = async (
  projectId: string,
  input: {
    readonly name: string;
    readonly command: string | null;
    readonly port: number;
    readonly protocol: "tcp" | "udp";
  },
): Promise<ServiceRecipeDto> => {
  const response = await fetch(`/api/projects/${projectId}/service-recipes`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (response.status === 401) throw redirect({ to: "/login" });
  if (!response.ok) {
    const body: { readonly message?: string } = await response.json().catch(() => ({}));
    throw new Error(body.message ?? `declare failed (${response.status})`);
  }
  const body: ServiceRecipeDto = await response.json();
  return body;
};

/** 204 on success — no body to parse. */
export const removeProjectRecipe = async (projectId: string, name: string): Promise<void> => {
  const response = await fetch(
    `/api/projects/${projectId}/service-recipes/${encodeURIComponent(name)}`,
    { method: "DELETE", credentials: "include" },
  );
  if (response.status === 401) throw redirect({ to: "/login" });
  if (!response.ok) throw new Error(`DELETE recipe ${name} responded ${response.status}`);
};

export const listSessionProcesses = (id: string) =>
  request<ReadonlyArray<SessionProcessDto>>(`/api/sessions/${id}/processes`);

export const listSessionRecipes = (id: string) =>
  request<ReadonlyArray<ServiceRecipeDto>>(`/api/sessions/${id}/recipes`);

export const runService = (
  sessionId: string,
  input: {
    argv: ReadonlyArray<string>;
    port: number;
    name: string | null;
    protocol?: "tcp" | "udp";
  },
) => post<SessionProcessDto>(`/api/sessions/${sessionId}/services/run`, input);

export const addService = (
  sessionId: string,
  input: { port: number; name: string | null; protocol?: "tcp" | "udp" },
) => post<SessionProcessDto>(`/api/sessions/${sessionId}/services`, input);

export const restartService = (id: string) =>
  post<SessionProcessDto>(`/api/services/${id}/restart`, {});

export const stopService = (id: string) => post<SessionProcessDto>(`/api/services/${id}/stop`, {});

/** The Service's reachable URL: the API carries no host — the browser's does. UDP has no page. */
export const serviceUrl = (service: SessionProcessDto) =>
  service.hostPort === null || service.protocol === "udp"
    ? null
    : `http://${window.location.hostname}:${service.hostPort}`;

/** What a client would connect to — the copyable fact, any protocol. */
export const serviceEndpoint = (service: SessionProcessDto) =>
  service.hostPort === null ? null : `${window.location.hostname}:${service.hostPort}`;

export const changeComments = (id: string) =>
  request<ReadonlyArray<ReviewCommentDto>>(`/api/changes/${id}/comments`);

export const postChangeComment = (
  id: string,
  input: {
    readonly file: string | null;
    readonly line: number | null;
    readonly endLine?: number | null;
    readonly body: string;
  },
) => post<ReviewCommentDto>(`/api/changes/${id}/comments`, input);

export interface FollowUpDto {
  readonly id: string;
  readonly sessionId: string;
  readonly changeId: string;
  readonly instruction: string;
  readonly status: "pending" | "delivered" | "superseded";
  readonly createdAt: string;
  readonly deliveredAt: string | null;
}

/** The review bundle, exactly as edited in the send dialog. */
export const createFollowUp = (sessionId: string, instruction: string) =>
  post<FollowUpDto>(`/api/sessions/${sessionId}/follow-up`, { instruction });

export const pendingFollowUp = (sessionId: string) =>
  request<FollowUpDto | null>(`/api/sessions/${sessionId}/follow-up`);

/** Marks the pending follow-up delivered and reopens the session. */
export const deliverFollowUp = (sessionId: string) =>
  post<FollowUpDto>(`/api/sessions/${sessionId}/follow-up/deliver`, {});

/** A reviewer's disposition on an existing comment (draft is machine-only). */
export const setCommentState = (
  changeId: string,
  commentId: string,
  state: "open" | "addressed" | "dismissed",
) => post<ReviewCommentDto>(`/api/changes/${changeId}/comments/${commentId}/state`, { state });

/** One conversation event of the canonical session record. */
export interface TranscriptEventDto {
  readonly kind: string;
  readonly text: string | null;
  readonly name: string | null;
  readonly command: string | null;
  readonly output: string | null;
}

export interface SessionTranscriptDto {
  readonly sourceHarness: string;
  readonly events: ReadonlyArray<TranscriptEventDto>;
}

/** The durable record, conversation-shaped — survives reloads, unlike SSE lines. */
export const sessionTranscript = (id: string) =>
  request<SessionTranscriptDto>(`/api/sessions/${id}/transcript`);

/**
 * How each harness takes an instruction as its opening prompt — the same
 * table the CLI's `mend continue` uses. Null: no known resume command.
 */
export const continueArgv = (harness: string, instruction: string): ReadonlyArray<string> | null =>
  harness === "codex"
    ? ["codex", instruction]
    : harness === "claude"
      ? ["claude", instruction]
      : harness === "opencode"
        ? ["opencode", "run", instruction]
        : null;

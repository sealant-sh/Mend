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

export interface ProjectDto {
  readonly id: string;
  readonly name: string;
  readonly originUrl: string | null;
  readonly storePath: string;
  readonly defaultBranch: string;
  readonly adoptedSha: string | null;
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

export interface ReviewCommentDto {
  readonly id: string;
  readonly changeId: string;
  readonly file: string | null;
  readonly line: number | null;
  readonly endLine: number | null;
  readonly authorKind: "reviewer" | "mend";
  readonly authorName: string;
  readonly body: string;
  readonly state: "draft" | "open" | "addressed" | "dismissed";
  readonly sentToSessionId: string | null;
  readonly createdAt: string;
}

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
export const adoptProject = async (name: string, source: string): Promise<ProjectDto> => {
  const response = await fetch("/api/projects", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, source }),
  });
  if (response.status === 401) throw redirect({ to: "/login" });
  if (!response.ok) {
    const body: { readonly message?: string } = await response.json().catch(() => ({}));
    throw new Error(body.message ?? `adoption failed (${response.status})`);
  }
  const body: ProjectDto = await response.json();
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

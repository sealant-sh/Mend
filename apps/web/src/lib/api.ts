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

export interface RunDto {
  readonly id: string;
  readonly issueId: string;
  readonly kind: "initial" | "follow-up" | "verification";
  readonly status: RunStatus;
  readonly outcome: "completed" | "failed" | null;
  readonly summary: string | null;
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

export interface RunDetailDto {
  readonly run: RunDto;
  readonly commands: ReadonlyArray<RunCommandDto>;
  readonly transcript: string | null;
  readonly recordError: string | null;
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
    };

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

export const createIssue = (input: {
  readonly repository: string;
  readonly title: string;
  readonly body: string;
}) => post<IssueDto>("/api/issues", { source: "manual", externalRef: null, ...input });

/** Gate 1 — the drag. `position` is the target index within queued; null appends. */
export const moveIssue = (id: string, stage: "triage" | "queued", position: number | null) =>
  post<IssueDto>(`/api/issues/${id}/move`, { stage, position });

export const sealantConnection = () => request<SealantConnectionDto>("/api/sealant/connection");

import { redirect } from "@tanstack/react-router";

/**
 * Wire shapes for the M0 surface, as JSON delivers them (dates are ISO
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
}

export interface SealantConnectionDto {
  readonly status: "connected" | "unauthorized" | "mismatched" | "unreachable";
  readonly baseUrl: string;
  readonly detail: string | null;
  readonly checkedAt: string;
}

async function apiGet<A>(path: string): Promise<A> {
  const response = await fetch(path, { credentials: "include" });
  if (response.status === 401) throw redirect({ to: "/login" });
  if (!response.ok) throw new Error(`GET ${path} responded ${response.status}`);
  const body: A = await response.json();
  return body;
}

export const listIssues = () => apiGet<ReadonlyArray<IssueDto>>("/api/issues");

export const sealantConnection = () => apiGet<SealantConnectionDto>("/api/sealant/connection");

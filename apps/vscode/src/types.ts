export const SESSION_STATUSES = [
  "starting",
  "running",
  "waiting",
  "idle",
  "completed",
  "failed",
  "stopped",
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly originUrl: string | null;
  readonly storePath: string;
  readonly defaultBranch: string;
}

export interface Session {
  readonly id: string;
  readonly projectId: string;
  readonly harness: string;
  readonly label: string | null;
  readonly worktree: string;
  readonly branch: string;
  readonly status: SessionStatus;
  readonly createdAt: string;
}

export interface ProjectDetail {
  readonly project: Project;
  readonly sessions: ReadonlyArray<Session>;
}

export interface RepositoryFacts {
  readonly path: string;
  readonly folder: string;
  readonly originUrl: string | null;
}

export type ProjectResolution =
  | { readonly status: "matched"; readonly project: Project; readonly matchedBy: string }
  | {
      readonly status: "ambiguous";
      readonly candidates: ReadonlyArray<Project>;
      readonly matchedBy: string;
    }
  | { readonly status: "not-found" };

export interface LaunchStart {
  readonly prompt?: string | undefined;
  readonly model?: string | undefined;
  readonly effort?: "low" | "medium" | "high" | "xhigh" | "max" | undefined;
  readonly permissionMode?: "ask" | undefined;
  readonly speed?: "fast" | undefined;
}

export interface SessionLocation {
  readonly project: Project;
  readonly session: Session;
  readonly worktreePath: string;
}

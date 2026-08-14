import {
  BriefCommentId,
  BriefDocument,
  EvidencePointer,
  FailureBrief,
  FollowUpId,
  InferenceCallId,
  IssueId,
  MendSettings,
  ReviewQuestionId,
  ReviewCommentId,
  type BriefId,
  type ChangeId,
  type CheckpointId,
  type CommentAuthorKind,
  type ContextSnapshotId,
  type Disposition,
  type Freshness,
  type InferenceContext,
  type InferenceToolName,
  type IssueSource,
  type IssueStage,
  type ProjectId,
  type ProjectMountId,
  type ReferenceId,
  type RoutedAction,
  type RunId,
  type RunKind,
  type RunOutcome,
  type RunStatus,
  type SealantRunId,
  type SealantWorkspaceId,
  type SessionGitOpId,
  type SessionId,
  type SessionProcessId,
  type Sha,
  WorkspaceImage,
} from "@mend/domain";
import type {
  AutomationChoice,
  CheckpointTrigger,
  ContextItem,
  FollowUpStatus,
  GitAuthMode,
  GitTransportKind,
  CommentAuthor,
  CommentKind,
  CommentState,
  PassKind,
  PassStatus,
  RecordLink,
  TourStop,
  SessionExtraMount,
  SessionProcessKind,
  SessionProcessStatus,
  SessionReferenceMount,
  SessionStatus,
} from "@mend/domain/workbench";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  snakeCase,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** Runtime schema for Mend-owned product state; the existing migrations remain authoritative. */
/** Keep TypeScript properties idiomatic while matching Mend's existing snake_case schema. */
const pgTable = snakeCase.table;

export const issues = pgTable(
  "issues",
  {
    id: text().$type<IssueId>().primaryKey(),
    source: text().$type<IssueSource>().notNull(),
    externalRef: text(),
    repository: text().notNull(),
    title: text().notNull(),
    body: text().notNull().default(""),
    stage: text().$type<IssueStage>().notNull().default("triage"),
    position: integer(),
    lastFailureRunId: text().$type<RunId>(),
    createdAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("issues_stage_position_idx").on(table.stage, table.position)],
);

export const changes = pgTable("changes", {
  id: text().$type<ChangeId>().primaryKey(),
  issueId: text()
    .$type<IssueId>()
    .notNull()
    .unique()
    .references(() => issues.id, { onDelete: "cascade" }),
  branch: text().notNull(),
  baseSha: text().$type<Sha>(),
  headSha: text().$type<Sha>(),
  prNumber: integer(),
  prUrl: text(),
  freshness: text().$type<Freshness>().notNull().default("current"),
  movedBaseSha: text().$type<Sha>(),
  createdAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
});

export const runs = pgTable(
  "runs",
  {
    id: text().$type<RunId>().primaryKey(),
    issueId: text()
      .$type<IssueId>()
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    changeId: text()
      .$type<ChangeId>()
      .references(() => changes.id, { onDelete: "set null" }),
    kind: text().$type<RunKind>().notNull(),
    sealantRunId: text().$type<SealantRunId>(),
    sealantWorkspaceId: text().$type<SealantWorkspaceId>(),
    status: text().$type<RunStatus>().notNull().default("queued"),
    outcome: text().$type<RunOutcome>(),
    summary: text(),
    lastSeenSequence: bigint({ mode: "bigint" }).notNull().default(0n),
    startedAt: timestamp({ mode: "date", withTimezone: true }),
    settledAt: timestamp({ mode: "date", withTimezone: true }),
    createdAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
    failureBrief: jsonb().$type<typeof FailureBrief.Encoded>(),
  },
  (table) => [index("runs_issue_idx").on(table.issueId)],
);

export const briefs = pgTable("briefs", {
  id: text().$type<BriefId>().primaryKey(),
  changeId: text()
    .$type<ChangeId>()
    .notNull()
    .unique()
    .references(() => changes.id, { onDelete: "cascade" }),
  currentVersion: integer().notNull().default(1),
  document: jsonb().$type<typeof BriefDocument.Encoded>().notNull(),
  createdAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
});

export const briefVersions = pgTable(
  "brief_versions",
  {
    briefId: text()
      .$type<BriefId>()
      .notNull()
      .references(() => briefs.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    document: jsonb().$type<typeof BriefDocument.Encoded>().notNull(),
    createdAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.briefId, table.version] })],
);

export const reviewQuestions = pgTable(
  "review_questions",
  {
    id: text().$type<ReviewQuestionId>().primaryKey(),
    briefId: text()
      .$type<BriefId>()
      .notNull()
      .references(() => briefs.id, { onDelete: "cascade" }),
    index: integer().notNull(),
    question: text().notNull(),
    disposition: text().$type<Disposition>().notNull(),
    evidence: jsonb()
      .$type<ReadonlyArray<typeof EvidencePointer.Encoded>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
  },
  (table) => [unique("review_questions_brief_id_index_key").on(table.briefId, table.index)],
);

export const briefComments = pgTable(
  "brief_comments",
  {
    id: text().$type<BriefCommentId>().primaryKey(),
    briefId: text()
      .$type<BriefId>()
      .notNull()
      .references(() => briefs.id, { onDelete: "cascade" }),
    thread: text().notNull(),
    authorKind: text().$type<CommentAuthorKind>().notNull(),
    authorName: text().notNull(),
    body: text().notNull(),
    routedAction: text().$type<RoutedAction>(),
    routedRunId: text().$type<RunId>(),
    createdAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("brief_comments_brief_idx").on(table.briefId, table.createdAt)],
);

export const projects = pgTable("projects", {
  id: text().$type<ProjectId>().primaryKey(),
  name: text().notNull().unique(),
  originUrl: text(),
  storePath: text().notNull().unique(),
  defaultBranch: text().notNull(),
  adoptedSha: text().$type<Sha>(),
  autoTour: text().$type<AutomationChoice>().notNull().default("inherit"),
  autoSuggest: text().$type<AutomationChoice>().notNull().default("inherit"),
  gitAuthMode: text().$type<GitAuthMode>().notNull().default("ambient"),
  // NULL inherits the global settings.workspaceImage default.
  workspaceImage: jsonb().$type<typeof WorkspaceImage.Encoded>(),
  createdAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
});

export const projectMounts = pgTable(
  "project_mounts",
  {
    id: text().$type<ProjectMountId>().primaryKey(),
    projectId: text()
      .$type<ProjectId>()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text().notNull(),
    hostPath: text().notNull(),
    readOnly: boolean().notNull().default(true),
    createdAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("project_mounts_project_id_name_key").on(table.projectId, table.name),
    unique("project_mounts_project_id_host_path_key").on(table.projectId, table.hostPath),
  ],
);

export const referenceRepos = pgTable("reference_repos", {
  id: text().$type<ReferenceId>().primaryKey(),
  name: text().notNull().unique(),
  originUrl: text().notNull(),
  path: text().notNull().unique(),
  pinnedRef: text(),
  headSha: text().$type<Sha>(),
  refreshedAt: timestamp({ mode: "date", withTimezone: true }),
  createdAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
});

export const projectReferences = pgTable(
  "project_references",
  {
    projectId: text()
      .$type<ProjectId>()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    referenceId: text()
      .$type<ReferenceId>()
      .notNull()
      .references(() => referenceRepos.id, { onDelete: "cascade" }),
    createdAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.referenceId] })],
);

export const settings = pgTable("settings", {
  key: text().primaryKey(),
  value: jsonb().$type<typeof MendSettings.Encoded>().notNull(),
  updatedAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
});

export const inferenceCalls = pgTable("inference_calls", {
  id: text().$type<InferenceCallId>().primaryKey(),
  context: text().$type<InferenceContext>().notNull(),
  tool: text().$type<InferenceToolName>(),
  input: jsonb().$type<unknown>().notNull(),
  output: jsonb().$type<unknown>().notNull(),
  occurredAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
});

export const pushDevices = pgTable("push_devices", {
  token: text().primaryKey(),
  platform: text().notNull(),
  createdAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
});

export const contextSnapshots = pgTable("context_snapshots", {
  id: text().$type<ContextSnapshotId>().primaryKey(),
  packName: text(),
  items: jsonb()
    .$type<ReadonlyArray<ContextItem>>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  createdAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
});

export const agentSessions = pgTable(
  "agent_sessions",
  {
    id: text().$type<SessionId>().primaryKey(),
    projectId: text()
      .$type<ProjectId>()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    harness: text().notNull(),
    providerSessionId: text(),
    label: text(),
    worktree: text().notNull(),
    branch: text().notNull(),
    baseSha: text().$type<Sha>().notNull(),
    contextSnapshotId: text()
      .$type<ContextSnapshotId>()
      .references(() => contextSnapshots.id, { onDelete: "set null" }),
    referenceMounts: jsonb()
      .$type<ReadonlyArray<SessionReferenceMount>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    extraMounts: jsonb()
      .$type<ReadonlyArray<SessionExtraMount>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    sealantRunId: text().$type<SealantRunId>(),
    sealantWorkspaceId: text().$type<SealantWorkspaceId>(),
    sealantSessionId: text(),
    // The image this session actually launched with — stamped at launch, never rewritten by a
    // later project-setting change. NULL for sessions from before the column (or not launched).
    workspaceImage: jsonb().$type<typeof WorkspaceImage.Encoded>(),
    status: text().$type<SessionStatus>().notNull().default("starting"),
    summary: text(),
    lastSeenSequence: bigint({ mode: "bigint" }).notNull().default(0n),
    recordHistoryComplete: boolean().notNull().default(false),
    startedAt: timestamp({ mode: "date", withTimezone: true }),
    settledAt: timestamp({ mode: "date", withTimezone: true }),
    createdAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("agent_sessions_project_idx").on(table.projectId, table.createdAt),
    index("agent_sessions_status_idx").on(table.status),
  ],
);

export const sessionRuns = pgTable(
  "session_runs",
  {
    sealantRunId: text().$type<SealantRunId>().primaryKey(),
    sessionId: text()
      .$type<SessionId>()
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    ordinal: integer().notNull(),
    harness: text().notNull(),
    sealantWorkspaceId: text().$type<SealantWorkspaceId>().notNull(),
    sealantSessionId: text(),
    status: text().$type<SessionStatus>().notNull(),
    summary: text(),
    lastSeenSequence: bigint({ mode: "bigint" }).notNull().default(0n),
    startedAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp({ mode: "date", withTimezone: true }),
    createdAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("session_runs_session_id_ordinal_key").on(table.sessionId, table.ordinal),
    index("session_runs_session_idx").on(table.sessionId, table.ordinal),
    uniqueIndex("session_runs_one_active_idx")
      .on(table.sessionId)
      .where(sql`${table.settledAt} IS NULL`),
  ],
);

export const sessionProcesses = pgTable(
  "session_processes",
  {
    id: text().$type<SessionProcessId>().primaryKey(),
    sessionId: text()
      .$type<SessionId>()
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    sealantWorkspaceId: text().$type<SealantWorkspaceId>().notNull(),
    sealantSessionId: text(),
    sealantRunId: text().$type<SealantRunId>(),
    kind: text().$type<SessionProcessKind>().notNull(),
    label: text(),
    argv: jsonb()
      .$type<ReadonlyArray<string>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    status: text().$type<SessionProcessStatus>().notNull().default("starting"),
    exitCode: integer(),
    workspacePort: integer(),
    protocol: text().$type<"tcp" | "udp">().notNull().default("tcp"),
    hostPort: integer(),
    createdAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
    exitedAt: timestamp({ mode: "date", withTimezone: true }),
    updatedAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("session_processes_session_idx").on(table.sessionId, table.createdAt),
    // Live rows are workspace leases — the reap path queries by workspace.
    index("session_processes_live_idx")
      .on(table.sealantWorkspaceId)
      .where(sql`${table.exitedAt} IS NULL`),
  ],
);

/**
 * Every remote git operation a workspace routed through the transport shim
 * (docs/GIT-ACCESS.md): the host opened the authenticated connection, so the
 * host records it. `refUpdates` carries the push's ref commands when the
 * pack stream offered them cheaply; a null exit code is an op still running
 * (or one whose end was lost to a restart).
 */
export const sessionGitOps = pgTable(
  "session_git_ops",
  {
    id: text().$type<SessionGitOpId>().primaryKey(),
    sessionId: text()
      .$type<SessionId>()
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    projectId: text().$type<ProjectId>().notNull(),
    host: text().notNull(),
    port: integer(),
    kind: text().$type<GitTransportKind>().notNull(),
    command: text().notNull(),
    authMode: text().$type<GitAuthMode>().notNull(),
    refUpdates: jsonb().$type<ReadonlyArray<string>>(),
    exitCode: integer(),
    startedAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ mode: "date", withTimezone: true }),
  },
  (table) => [index("session_git_ops_session_idx").on(table.sessionId, table.startedAt)],
);

export const projectServiceRecipes = pgTable(
  "project_service_recipes",
  {
    projectId: text()
      .$type<ProjectId>()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text().notNull(),
    command: text(),
    port: integer().notNull(),
    protocol: text().$type<"tcp" | "udp">().notNull().default("tcp"),
    createdAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.name] })],
);

export const sessionChanges = pgTable("session_changes", {
  id: text().$type<ChangeId>().primaryKey(),
  projectId: text()
    .$type<ProjectId>()
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sessionId: text()
    .$type<SessionId>()
    .notNull()
    .unique()
    .references(() => agentSessions.id, { onDelete: "cascade" }),
  branch: text().notNull(),
  baseSha: text().$type<Sha>().notNull(),
  headSha: text().$type<Sha>(),
  createdAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
});

export const followUps = pgTable(
  "follow_ups",
  {
    id: text().$type<FollowUpId>().primaryKey(),
    sessionId: text()
      .$type<SessionId>()
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    changeId: text()
      .$type<ChangeId>()
      .notNull()
      .references(() => sessionChanges.id, { onDelete: "cascade" }),
    instruction: text().notNull(),
    status: text().$type<FollowUpStatus>().notNull().default("pending"),
    createdAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp({ mode: "date", withTimezone: true }),
  },
  (table) => [index("follow_ups_session_idx").on(table.sessionId, table.createdAt)],
);

export const reviewComments = pgTable(
  "review_comments",
  {
    id: text().$type<ReviewCommentId>().primaryKey(),
    changeId: text()
      .$type<ChangeId>()
      .notNull()
      .references(() => sessionChanges.id, { onDelete: "cascade" }),
    file: text(),
    line: integer(),
    authorKind: text().$type<CommentAuthor>().notNull(),
    authorName: text().notNull(),
    body: text().notNull(),
    state: text().$type<CommentState>().notNull().default("open"),
    sentToSessionId: text()
      .$type<SessionId>()
      .references(() => agentSessions.id, { onDelete: "set null" }),
    createdAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
    endLine: integer(),
    evidence: jsonb()
      .$type<ReadonlyArray<typeof RecordLink.Encoded>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    kind: text().$type<CommentKind>().notNull().default("note"),
    suggestion: text(),
  },
  (table) => [index("review_comments_change_idx").on(table.changeId, table.createdAt)],
);

export const changeTours = pgTable("change_tours", {
  id: text().primaryKey(),
  changeId: text()
    .$type<ChangeId>()
    .notNull()
    .unique()
    .references(() => sessionChanges.id, { onDelete: "cascade" }),
  sessionId: text()
    .$type<SessionId>()
    .notNull()
    .references(() => agentSessions.id, { onDelete: "cascade" }),
  summary: text().notNull(),
  approach: text(),
  stops: jsonb().$type<ReadonlyArray<typeof TourStop.Encoded>>().notNull(),
  diffDigest: text().notNull(),
  createdAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
});

export const changePasses = pgTable(
  "change_passes",
  {
    changeId: text()
      .$type<ChangeId>()
      .notNull()
      .references(() => sessionChanges.id, { onDelete: "cascade" }),
    kind: text().$type<PassKind>().notNull(),
    status: text().$type<PassStatus>().notNull(),
    detail: text(),
    findings: integer(),
    startedAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ mode: "date", withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.changeId, table.kind] })],
);

export const checkpoints = pgTable(
  "checkpoints",
  {
    id: text().$type<CheckpointId>().primaryKey(),
    sessionId: text()
      .$type<SessionId>()
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    ref: text().notNull(),
    sha: text().$type<Sha>().notNull(),
    sealantRunId: text()
      .$type<SealantRunId>()
      .references(() => sessionRuns.sealantRunId, { onDelete: "set null" }),
    seq: bigint({ mode: "bigint" }).notNull().default(0n),
    trigger: text().$type<CheckpointTrigger>().notNull(),
    createdAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("checkpoints_session_idx").on(table.sessionId, table.seq),
    index("checkpoints_session_created_idx").on(table.sessionId, table.createdAt),
  ],
);

export type ProjectRow = typeof projects.$inferSelect;
export type IssueRow = typeof issues.$inferSelect;
export type ChangeRow = typeof changes.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type BriefRow = typeof briefs.$inferSelect;
export type BriefVersionRow = typeof briefVersions.$inferSelect;
export type ReviewQuestionRow = typeof reviewQuestions.$inferSelect;
export type BriefCommentRow = typeof briefComments.$inferSelect;
export type ProjectMountRow = typeof projectMounts.$inferSelect;
export type ReferenceRepoRow = typeof referenceRepos.$inferSelect;
export type ProjectReferenceRow = typeof projectReferences.$inferSelect;
export type SettingsRow = typeof settings.$inferSelect;
export type InferenceCallRow = typeof inferenceCalls.$inferSelect;
export type PushDeviceRow = typeof pushDevices.$inferSelect;
export type ContextSnapshotRow = typeof contextSnapshots.$inferSelect;
export type AgentSessionRow = typeof agentSessions.$inferSelect;
export type SessionRunRow = typeof sessionRuns.$inferSelect;
export type SessionChangeRow = typeof sessionChanges.$inferSelect;
export type FollowUpRow = typeof followUps.$inferSelect;
export type ReviewCommentRow = typeof reviewComments.$inferSelect;
export type ChangeTourRow = typeof changeTours.$inferSelect;
export type ChangePassRow = typeof changePasses.$inferSelect;
export type CheckpointRow = typeof checkpoints.$inferSelect;

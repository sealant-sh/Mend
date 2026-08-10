import {
  FollowUpId,
  InferenceCallId,
  MendSettings,
  ReviewCommentId,
  type ChangeId,
  type CheckpointId,
  type ContextSnapshotId,
  type InferenceContext,
  type InferenceToolName,
  type ProjectId,
  type ProjectMountId,
  type ReferenceId,
  type SealantRunId,
  type SealantWorkspaceId,
  type SessionId,
  type Sha,
} from "@mend/domain";
import type {
  AutomationChoice,
  CheckpointTrigger,
  ContextItem,
  FollowUpStatus,
  CommentAuthor,
  CommentKind,
  CommentState,
  PassKind,
  PassStatus,
  RecordLink,
  TourStop,
  SessionExtraMount,
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

/**
 * Runtime schema for the first repository migration slice. Additional table groups move here with
 * the small PR that converts their repositories; the existing migrations remain authoritative
 * until that incremental conversion is complete.
 */
/** Keep TypeScript properties idiomatic while matching Mend's existing snake_case schema. */
const pgTable = snakeCase.table;

export const projects = pgTable("projects", {
  id: text().$type<ProjectId>().primaryKey(),
  name: text().notNull().unique(),
  originUrl: text(),
  storePath: text().notNull().unique(),
  defaultBranch: text().notNull(),
  adoptedSha: text().$type<Sha>(),
  autoTour: text().$type<AutomationChoice>().notNull().default("inherit"),
  autoSuggest: text().$type<AutomationChoice>().notNull().default("inherit"),
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

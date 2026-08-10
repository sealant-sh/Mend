import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  agentSessions,
  briefComments,
  briefVersions,
  briefs,
  changePasses,
  changeTours,
  changes,
  checkpoints,
  contextSnapshots,
  followUps,
  inferenceCalls,
  issues,
  projectMounts,
  projectReferences,
  projects,
  pushDevices,
  referenceRepos,
  reviewQuestions,
  reviewComments,
  runs,
  sessionChanges,
  sessionRuns,
  settings,
} from "../src/schema/workbench.ts";

describe("Mend Drizzle schema", () => {
  it("maps the retiring issue, change, and run graph", () => {
    expect([issues, changes, runs].map((table) => getTableConfig(table).name)).toEqual([
      "issues",
      "changes",
      "runs",
    ]);
    expect(getTableConfig(issues).columns.map((column) => column.name)).toEqual([
      "id",
      "source",
      "external_ref",
      "repository",
      "title",
      "body",
      "stage",
      "position",
      "last_failure_run_id",
      "created_at",
      "updated_at",
    ]);
    expect(getTableConfig(issues).indexes[0]?.config.name).toBe("issues_stage_position_idx");
    expect(getTableConfig(changes).columns[1]?.isUnique).toBe(true);
    expect(getTableConfig(changes).foreignKeys[0]?.onDelete).toBe("cascade");
    expect(getTableConfig(runs).columns.map((column) => column.name)).toEqual([
      "id",
      "issue_id",
      "change_id",
      "kind",
      "sealant_run_id",
      "sealant_workspace_id",
      "status",
      "outcome",
      "summary",
      "last_seen_sequence",
      "started_at",
      "settled_at",
      "created_at",
      "updated_at",
      "failure_brief",
    ]);
    expect(runs.lastSeenSequence.getSQLType()).toBe("bigint");
    expect(runs.failureBrief.getSQLType()).toBe("jsonb");
    expect(getTableConfig(runs).foreignKeys.map((foreignKey) => foreignKey.onDelete)).toEqual([
      "cascade",
      "set null",
    ]);
  });

  it("maps living briefs, immutable versions, question indexes, and comments", () => {
    expect(
      [briefs, briefVersions, reviewQuestions, briefComments].map(
        (table) => getTableConfig(table).name,
      ),
    ).toEqual(["briefs", "brief_versions", "review_questions", "brief_comments"]);
    expect(briefs.document.getSQLType()).toBe("jsonb");
    expect(briefVersions.document.getSQLType()).toBe("jsonb");
    expect(reviewQuestions.evidence.getSQLType()).toBe("jsonb");
    expect(
      getTableConfig(briefVersions).primaryKeys[0]?.columns.map((column) => column.name),
    ).toEqual(["brief_id", "version"]);
    expect(getTableConfig(reviewQuestions).uniqueConstraints[0]?.name).toBe(
      "review_questions_brief_id_index_key",
    );
    expect(getTableConfig(briefComments).indexes[0]?.config.name).toBe("brief_comments_brief_idx");
    for (const table of [briefs, briefVersions, reviewQuestions, briefComments]) {
      expect(getTableConfig(table).foreignKeys[0]?.onDelete).toBe("cascade");
    }
  });

  it("maps the session graph to the existing PostgreSQL table and column names", () => {
    expect(
      [projects, contextSnapshots, agentSessions, sessionRuns, sessionChanges, checkpoints].map(
        (table) => getTableConfig(table).name,
      ),
    ).toEqual([
      "projects",
      "context_snapshots",
      "agent_sessions",
      "session_runs",
      "session_changes",
      "checkpoints",
    ]);

    expect(getTableConfig(agentSessions).columns.map((column) => column.name)).toEqual([
      "id",
      "project_id",
      "harness",
      "provider_session_id",
      "label",
      "worktree",
      "branch",
      "base_sha",
      "context_snapshot_id",
      "reference_mounts",
      "extra_mounts",
      "sealant_run_id",
      "sealant_workspace_id",
      "sealant_session_id",
      "status",
      "summary",
      "last_seen_sequence",
      "record_history_complete",
      "started_at",
      "settled_at",
      "created_at",
      "updated_at",
    ]);
  });

  it("preserves run-local bigint cursors and the one-active-run invariant", () => {
    expect(sessionRuns.lastSeenSequence.getSQLType()).toBe("bigint");
    expect(checkpoints.seq.getSQLType()).toBe("bigint");

    const activeRunIndex = getTableConfig(sessionRuns).indexes.find(
      (candidate) => candidate.config.name === "session_runs_one_active_idx",
    );
    expect(activeRunIndex?.config.unique).toBe(true);
    expect(activeRunIndex?.config.where).toBeDefined();
  });

  it("matches project mount ownership and uniqueness constraints", () => {
    const config = getTableConfig(projectMounts);
    expect(config.name).toBe("project_mounts");
    expect(config.columns.map((column) => column.name)).toEqual([
      "id",
      "project_id",
      "name",
      "host_path",
      "read_only",
      "created_at",
      "updated_at",
    ]);
    expect(config.foreignKeys[0]?.onDelete).toBe("cascade");
    expect(config.uniqueConstraints.map((constraint) => constraint.name).toSorted()).toEqual([
      "project_mounts_project_id_host_path_key",
      "project_mounts_project_id_name_key",
    ]);
  });

  it("maps reference repositories and per-project selection", () => {
    const referenceConfig = getTableConfig(referenceRepos);
    expect(referenceConfig.name).toBe("reference_repos");
    expect(referenceConfig.columns.map((column) => column.name)).toEqual([
      "id",
      "name",
      "origin_url",
      "path",
      "pinned_ref",
      "head_sha",
      "refreshed_at",
      "created_at",
      "updated_at",
    ]);
    expect(referenceConfig.columns[1]?.isUnique).toBe(true);
    expect(referenceConfig.columns[3]?.isUnique).toBe(true);

    const selectionConfig = getTableConfig(projectReferences);
    expect(selectionConfig.name).toBe("project_references");
    expect(selectionConfig.columns.map((column) => column.name)).toEqual([
      "project_id",
      "reference_id",
      "created_at",
    ]);
    expect(selectionConfig.primaryKeys[0]?.columns.map((column) => column.name)).toEqual([
      "project_id",
      "reference_id",
    ]);
    expect(selectionConfig.foreignKeys.map((foreignKey) => foreignKey.onDelete)).toEqual([
      "cascade",
      "cascade",
    ]);
  });

  it("maps the singleton settings document without changing its migration shape", () => {
    const config = getTableConfig(settings);
    expect(config.name).toBe("settings");
    expect(config.columns.map((column) => column.name)).toEqual(["key", "value", "updated_at"]);
    expect(config.columns[0]?.primary).toBe(true);
    expect(config.columns[1]?.getSQLType()).toBe("jsonb");
  });

  it("maps the append-only inference audit record", () => {
    const config = getTableConfig(inferenceCalls);
    expect(config.name).toBe("inference_calls");
    expect(config.columns.map((column) => column.name)).toEqual([
      "id",
      "context",
      "tool",
      "input",
      "output",
      "occurred_at",
    ]);
    expect(config.columns[3]?.getSQLType()).toBe("jsonb");
    expect(config.columns[4]?.getSQLType()).toBe("jsonb");
  });

  it("maps push device identity and activity timestamps", () => {
    const config = getTableConfig(pushDevices);
    expect(config.name).toBe("push_devices");
    expect(config.columns.map((column) => column.name)).toEqual([
      "token",
      "platform",
      "created_at",
      "last_seen_at",
    ]);
    expect(config.columns[0]?.primary).toBe(true);
  });

  it("maps follow-up ownership, status, and delivery timestamps", () => {
    const config = getTableConfig(followUps);
    expect(config.name).toBe("follow_ups");
    expect(config.columns.map((column) => column.name)).toEqual([
      "id",
      "session_id",
      "change_id",
      "instruction",
      "status",
      "created_at",
      "delivered_at",
    ]);
    expect(config.foreignKeys.map((foreignKey) => foreignKey.onDelete)).toEqual([
      "cascade",
      "cascade",
    ]);
    expect(config.indexes[0]?.config.name).toBe("follow_ups_session_idx");
  });

  it("maps review comment anchors, evidence, and notification ownership", () => {
    const config = getTableConfig(reviewComments);
    expect(config.name).toBe("review_comments");
    expect(config.columns.map((column) => column.name)).toEqual([
      "id",
      "change_id",
      "file",
      "line",
      "author_kind",
      "author_name",
      "body",
      "state",
      "sent_to_session_id",
      "created_at",
      "updated_at",
      "end_line",
      "evidence",
      "kind",
      "suggestion",
    ]);
    expect(config.columns[12]?.getSQLType()).toBe("jsonb");
    expect(config.foreignKeys.map((foreignKey) => foreignKey.onDelete)).toEqual([
      "cascade",
      "set null",
    ]);
    expect(config.indexes[0]?.config.name).toBe("review_comments_change_idx");
  });

  it("maps one composed tour per change with encoded stops", () => {
    const config = getTableConfig(changeTours);
    expect(config.name).toBe("change_tours");
    expect(config.columns.map((column) => column.name)).toEqual([
      "id",
      "change_id",
      "session_id",
      "summary",
      "approach",
      "stops",
      "diff_digest",
      "created_at",
    ]);
    expect(config.columns[5]?.getSQLType()).toBe("jsonb");
    expect(config.columns[1]?.isUnique).toBe(true);
    expect(config.foreignKeys.map((foreignKey) => foreignKey.onDelete)).toEqual([
      "cascade",
      "cascade",
    ]);
  });

  it("maps one machine-pass outcome per change and kind", () => {
    const config = getTableConfig(changePasses);
    expect(config.name).toBe("change_passes");
    expect(config.columns.map((column) => column.name)).toEqual([
      "change_id",
      "kind",
      "status",
      "detail",
      "findings",
      "started_at",
      "finished_at",
    ]);
    expect(config.primaryKeys[0]?.columns.map((column) => column.name)).toEqual([
      "change_id",
      "kind",
    ]);
    expect(config.foreignKeys[0]?.onDelete).toBe("cascade");
  });

  it("keeps destructive ownership and nullable evidence links explicit", () => {
    const sessionForeignKeys = getTableConfig(agentSessions).foreignKeys;
    const projectForeignKey = sessionForeignKeys.find(
      (foreignKey) => foreignKey.reference().columns[0]?.name === "project_id",
    );
    const snapshotForeignKey = sessionForeignKeys.find(
      (foreignKey) => foreignKey.reference().columns[0]?.name === "context_snapshot_id",
    );
    const checkpointRunForeignKey = getTableConfig(checkpoints).foreignKeys.find(
      (foreignKey) => foreignKey.reference().columns[0]?.name === "sealant_run_id",
    );

    expect(projectForeignKey?.onDelete).toBe("cascade");
    expect(snapshotForeignKey?.onDelete).toBe("set null");
    expect(checkpointRunForeignKey?.onDelete).toBe("set null");
  });
});

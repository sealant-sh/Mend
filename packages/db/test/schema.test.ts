import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  agentSessions,
  changeTours,
  checkpoints,
  contextSnapshots,
  followUps,
  inferenceCalls,
  projectMounts,
  projects,
  pushDevices,
  reviewComments,
  sessionChanges,
  sessionRuns,
  settings,
} from "../src/schema/workbench.ts";

describe("workbench Drizzle schema", () => {
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

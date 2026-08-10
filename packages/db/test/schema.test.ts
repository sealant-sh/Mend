import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  agentSessions,
  checkpoints,
  contextSnapshots,
  projectMounts,
  projects,
  sessionChanges,
  sessionRuns,
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

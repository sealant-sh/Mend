import { Schema } from "effect";

import {
  ContextSnapshotId,
  ProjectId,
  SealantRunId,
  SealantWorkspaceId,
  SessionId,
  Sha,
} from "../ids.ts";
import { SessionExtraMount } from "./mount.ts";
import { SessionReferenceMount } from "./reference.ts";

/**
 * Lifecycle of a supervised coding-agent process (plan §5.5). `waiting` and
 * `idle` are workbench states the queue-era RunStatus never had: waiting means
 * the harness asked for input; idle means the PTY is alive with no activity.
 */
export const SessionStatus = Schema.Literals([
  "starting",
  "running",
  "waiting",
  "idle",
  "completed",
  "failed",
  "stopped",
]);
export type SessionStatus = typeof SessionStatus.Type;

/**
 * One supervised coding-agent process in its own store worktree (plan §5.5).
 * At the Sealant layer a session is backed by a run and its durable record —
 * evidence is addressed by `(sealantRunId, sequence)` exactly as before. The
 * recording stays in Sealant; this row is Mend's index over it.
 */
export class Session extends Schema.Class<Session>("Session")({
  id: SessionId,
  projectId: ProjectId,
  /** The adapter that launched it: `codex` · `claude` · `opencode` · `custom`. */
  harness: Schema.String,
  /** Provider-native session/thread id when the adapter can extract one. */
  providerSessionId: Schema.NullOr(Schema.String),
  /** Optional human label ("reaper retry storm"); sessions have no issue titles. */
  label: Schema.NullOr(Schema.String),
  /** Worktree directory name inside the project's store. */
  worktree: Schema.String,
  /** The session branch the worktree is on. */
  branch: Schema.String,
  /** Where the worktree branched from — the change's comparison base. */
  baseSha: Sha,
  contextSnapshotId: Schema.NullOr(ContextSnapshotId),
  /** References mounted read-only beside the worktree at launch, SHAs as observed then. */
  referenceMounts: Schema.Array(SessionReferenceMount),
  /** Project folders mounted beside the worktree at launch — what the agent could see. */
  extraMounts: Schema.Array(SessionExtraMount),
  sealantRunId: Schema.NullOr(SealantRunId),
  sealantWorkspaceId: Schema.NullOr(SealantWorkspaceId),
  /** The platform's interactive PTY session id (0.7.0) — the reattach handle. */
  sealantSessionId: Schema.NullOr(Schema.String),
  status: SessionStatus,
  /** What the harness reported at settle, when anything. */
  summary: Schema.NullOr(Schema.String),
  /** Last record sequence the supervisor persisted — crash-resume re-attaches from here. */
  lastSeenSequence: Schema.BigInt,
  startedAt: Schema.NullOr(Schema.Date),
  settledAt: Schema.NullOr(Schema.Date),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {}

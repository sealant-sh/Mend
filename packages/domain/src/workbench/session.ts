import { Schema } from "effect";

import {
  ContextSnapshotId,
  ProjectId,
  SealantRunId,
  SealantWorkspaceId,
  SessionId,
  Sha,
} from "../ids.ts";
import { WorkspaceImage } from "../settings.ts";
import { SessionExtraMount } from "./mount.ts";
import { SessionReferenceMount } from "./reference.ts";

/**
 * What a launch actually applied from the owner's dotfiles — recorded facts, never rewritten by
 * a later sync or config change. The snapshot sha names an exact commit in the user's dotfiles
 * store; the repository is the url+ref that was cloned (its content is not pinned — the clone
 * takes the branch tip at launch).
 */
export const SessionDotfiles = Schema.Struct({
  repository: Schema.NullOr(
    Schema.Struct({
      url: Schema.String,
      ref: Schema.NullOr(Schema.String),
    }),
  ),
  snapshotSha: Schema.NullOr(Schema.String),
});
export type SessionDotfiles = typeof SessionDotfiles.Type;

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
 * One logical coding-agent conversation in its own store worktree (plan §5.5). A settled-session
 * resume starts another Sealant run; SessionRun owns the ordered membership and per-run cursors.
 * The recording stays in Sealant and evidence addresses it by `(sealantRunId, sequence)`.
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
  /** Latest run pointer retained for list/API compatibility; SessionRun is authoritative. */
  sealantRunId: Schema.NullOr(SealantRunId),
  /** Latest workspace pointer used for active control and settle-time harvesting. */
  sealantWorkspaceId: Schema.NullOr(SealantWorkspaceId),
  /** Latest platform interactive PTY session id — the live reattach handle. */
  sealantSessionId: Schema.NullOr(Schema.String),
  /** The image this session actually launched with; null before launch (or pre-column rows). */
  workspaceImage: Schema.NullOr(WorkspaceImage),
  /** The dotfiles this session actually launched with; null before launch (or none applied). */
  dotfiles: Schema.NullOr(SessionDotfiles),
  /** Who provisioned the session — whose dotfiles apply. Null for pre-column rows. */
  ownerUserId: Schema.NullOr(Schema.String),
  status: SessionStatus,
  /** What the harness reported at settle, when anything. */
  summary: Schema.NullOr(Schema.String),
  /** Latest run's progress mirror for list surfaces; supervision reads the per-run cursor. */
  lastSeenSequence: Schema.BigInt,
  /** False for migrated sessions whose previously overwritten run ids cannot be recovered. */
  recordHistoryComplete: Schema.Boolean,
  startedAt: Schema.NullOr(Schema.Date),
  settledAt: Schema.NullOr(Schema.Date),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {}

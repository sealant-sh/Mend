import { Schema } from "effect";

import { SealantRunId, SealantWorkspaceId, SessionId } from "../ids.ts";
import { SessionStatus } from "./session.ts";

/**
 * One Sealant execution record belonging to a logical Mend session. Resuming a settled session
 * starts a fresh platform run; its sequence space starts at zero and must never reuse the previous
 * run's supervision cursor.
 */
export class SessionRun extends Schema.Class<SessionRun>("SessionRun")({
  sealantRunId: SealantRunId,
  sessionId: SessionId,
  /** Stable launch order within the session; sequence numbers are local to this ordinal. */
  ordinal: Schema.Int,
  /** Harness used for this execution segment (a session may resume with another harness). */
  harness: Schema.String,
  sealantWorkspaceId: SealantWorkspaceId,
  /** Null for legacy/non-PTY attach paths. */
  sealantSessionId: Schema.NullOr(Schema.String),
  status: SessionStatus,
  summary: Schema.NullOr(Schema.String),
  /** Crash-resume cursor for this Sealant run alone. */
  lastSeenSequence: Schema.BigInt,
  /**
   * SAFE launch manifest of the project environment this run's workspace was created with:
   * aggregate revision plus name-sorted variable NAMES — never values, never hashes. Lives here,
   * not on Session, because one logical session can resume into several workspaces with different
   * project settings. Null on both fields = explicit legacy/unknown (attached externally or
   * created before the feature); never inferred.
   */
  environmentRevision: Schema.NullOr(Schema.Int),
  environmentVariableNames: Schema.NullOr(Schema.Array(Schema.String)),
  /** Same manifest for the project's Secrets set — names only, by construction. */
  secretRevision: Schema.NullOr(Schema.Int),
  secretNames: Schema.NullOr(Schema.Array(Schema.String)),
  startedAt: Schema.Date,
  settledAt: Schema.NullOr(Schema.Date),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {}

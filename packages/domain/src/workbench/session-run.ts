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
  startedAt: Schema.Date,
  settledAt: Schema.NullOr(Schema.Date),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {}

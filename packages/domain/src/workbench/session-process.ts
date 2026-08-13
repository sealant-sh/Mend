import { Schema } from "effect";

import { SealantRunId, SealantWorkspaceId, SessionId, SessionProcessId } from "../ids.ts";

/**
 * What kind of work a workspace process is doing. The agent is one process in
 * the workspace, not its owner (docs/SESSION-SERVICES.md): shells and Services
 * share the same runtime and the same record shape.
 */
export const SessionProcessKind = Schema.Literals(["agent", "shell", "service"]);
export type SessionProcessKind = typeof SessionProcessKind.Type;

/**
 * Observed lifecycle only — never a judgment about the work. `reachable` /
 * `unreachable` belong to Services: the forwarded port answered, or did not.
 */
export const SessionProcessStatus = Schema.Literals([
  "starting",
  "running",
  "reachable",
  "unreachable",
  "exited",
  "stopped",
]);
export type SessionProcessStatus = typeof SessionProcessStatus.Type;

/**
 * One platform PTY (or supervised process, or adopted Service port) in a
 * session's current workspace. A session has many of these over its life —
 * the agent, shells, Services — each independently attachable and
 * independently settled. Live rows are the workspace's leases: the container
 * is reclaimed only when the last one ends.
 */
export class SessionProcess extends Schema.Class<SessionProcess>("SessionProcess")({
  id: SessionProcessId,
  sessionId: SessionId,
  /** The workspace incarnation this process ran in; processes never migrate. */
  sealantWorkspaceId: SealantWorkspaceId,
  /** The platform interactive-session id — the attach handle. Null for adopted Services (no process of ours). */
  sealantSessionId: Schema.NullOr(Schema.String),
  /** The run recording this process — its record outlives the process AND the workspace. */
  sealantRunId: Schema.NullOr(SealantRunId),
  kind: SessionProcessKind,
  /** Human name for pickers and lists ("claude", "shell", "web"). */
  label: Schema.NullOr(Schema.String),
  argv: Schema.Array(Schema.String),
  status: SessionProcessStatus,
  /** Observed exit code, when the platform reported one. */
  exitCode: Schema.NullOr(Schema.Int),
  /** Services: the port the process listens on INSIDE the workspace. */
  workspacePort: Schema.NullOr(Schema.Int),
  /** Services: declared transport. UDP relays datagrams; there is no probe. */
  protocol: Schema.Literals(["tcp", "udp"]),
  /** Services: the host port Mend binds on its private interfaces. */
  hostPort: Schema.NullOr(Schema.Int),
  createdAt: Schema.Date,
  exitedAt: Schema.NullOr(Schema.Date),
  updatedAt: Schema.Date,
}) {}

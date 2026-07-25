import { Schema } from "effect";

import { ChangeId, FollowUpId, SessionId } from "../ids.ts";

/**
 * `pending` — assembled and waiting for the session to pick it up.
 * `delivered` — the session resumed with this instruction.
 * `superseded` — a newer follow-up replaced it before delivery.
 */
export const FollowUpStatus = Schema.Literals(["pending", "delivered", "superseded"]);
export type FollowUpStatus = typeof FollowUpStatus.Type;

/**
 * A review bundle sent back to the session (plan §7.3): the comments
 * assembled into one instruction, inspected and edited by the user before
 * sending — never fired blind. Today delivery is `mend continue` relaunching
 * the harness in the same worktree; when the platform ships PTY input, the
 * same row feeds the live session instead.
 */
export class FollowUp extends Schema.Class<FollowUp>("FollowUp")({
  id: FollowUpId,
  sessionId: SessionId,
  changeId: ChangeId,
  /** The instruction as the user approved it — verbatim what the harness receives. */
  instruction: Schema.String,
  status: FollowUpStatus,
  createdAt: Schema.Date,
  deliveredAt: Schema.NullOr(Schema.Date),
}) {}

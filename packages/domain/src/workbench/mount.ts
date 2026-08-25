import { Schema } from "effect";

import { ProjectId, ProjectMountId } from "../ids.ts";
import { Timestamp } from "../timestamp.ts";

/**
 * A host folder this project's sessions can see (plan §17, decided
 * 2026-08-01): a sibling repository, an uncommitted experiments folder —
 * mounted at `/workspace/home/<name>`, beside the worktree, never inside it.
 * Read-only by default: extra mounts widen what the agent can see, not what
 * Mend reviews — the reviewable change stays exactly worktree-versus-base.
 * A read-write mount is a deliberate per-folder choice; writes to it land
 * directly on the host folder and are not part of the reviewed change.
 */
export class ProjectMount extends Schema.Class<ProjectMount>("ProjectMount")({
  id: ProjectMountId,
  projectId: ProjectId,
  /** Short name; also the mount directory name under `/workspace/home/`. */
  name: Schema.String,
  /** Absolute host path of the folder, exactly as the user declared it. */
  hostPath: Schema.String,
  readOnly: Schema.Boolean,
  createdAt: Timestamp,
  updatedAt: Timestamp,
}) {}

/**
 * What a session actually received: one project mount as bound at launch.
 * Declared on the session record so the review surface can state what the
 * agent could see — and, for a read-write mount, where unrecorded writes
 * could land.
 */
export class SessionExtraMount extends Schema.Class<SessionExtraMount>("SessionExtraMount")({
  name: Schema.String,
  hostPath: Schema.String,
  /** Container path the folder was mounted at, e.g. `/workspace/home/experiments`. */
  mountPath: Schema.String,
  readOnly: Schema.Boolean,
}) {}

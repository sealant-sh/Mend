import { Schema } from "effect";

import { ProjectId, ProjectLinkId } from "../ids.ts";
import { Timestamp } from "../timestamp.ts";

/**
 * A linked project (ADR-0001): another adopted project this project's sessions
 * can work in, read-write, at `/workspace/repos/<name>`. The session's
 * workspace mounts the linked project's worktrees directory as a bindable root
 * and binds the named worktree at launch, so a session in one repository can
 * change a sibling repository as itself.
 *
 * Distinct from a reference (a read-only clone of an external repository, for
 * reading) and from a project mount (an arbitrary host folder, which cannot
 * exist on a cluster). Writes land in the linked project's worktree and are
 * that project's own change, never part of this session's reviewed change.
 */
export class ProjectLink extends Schema.Class<ProjectLink>("ProjectLink")({
  id: ProjectLinkId,
  projectId: ProjectId,
  /** The project mounted in. Never the project itself. */
  linkedProjectId: ProjectId,
  /** Short name; also the directory name under `/workspace/repos/`. */
  name: Schema.String,
  /** The linked project's worktree bound at launch, by its worktree name. */
  worktreeName: Schema.String,
  createdAt: Timestamp,
  updatedAt: Timestamp,
}) {}

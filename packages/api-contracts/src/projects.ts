import { ProjectId, ProjectMountId, ReferenceId, SessionId } from "@mend/domain";
import {
  Project,
  ProjectEnvironmentVariable,
  ProjectMount,
  Reference,
} from "@mend/domain/workbench";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

import { NotFound } from "./accounts.ts";
import { AuthMiddleware } from "./common.ts";
import { ProjectFileListing, ProjectPullRequests } from "./settings.ts";
import {
  AdoptProject,
  GitBridgeStatusView,
  GitKeyView,
  ProjectApplyDotfilesRequest,
  ProjectAutomationRequest,
  ProjectDetail,
  ProjectGitAuthRequest,
  ProjectHotSessionsRequest,
  ProjectHotSessionsStatus,
  ProjectWorkspaceImageRequest,
  ProjectWorkspaceImageSaveResult,
  RemovalReport,
  SettingsFailure,
  StoreFailure,
} from "./workbench-views.ts";

export const projectsGroup = HttpApiGroup.make("projects")
  .add(HttpApiEndpoint.get("list", "/projects", { success: Schema.Array(Project) }))
  .add(
    HttpApiEndpoint.post("adopt", "/projects", {
      payload: AdoptProject,
      success: Project,
      error: StoreFailure,
    }),
  )
  .add(
    HttpApiEndpoint.get("detail", "/projects/:id", {
      params: { id: ProjectId },
      success: ProjectDetail,
      error: NotFound,
    }),
  )
  .add(
    // Removal stops the project's live sessions, deletes every row under it,
    // and removes the store copy. `leftover` reports a path that would not
    // delete (container-uid files) — honesty over a false clean.
    HttpApiEndpoint.delete("remove", "/projects/:id", {
      params: { id: ProjectId },
      success: RemovalReport,
      error: Schema.Union([NotFound, StoreFailure]),
    }),
  )
  .add(
    HttpApiEndpoint.put("automation", "/projects/:id/automation", {
      params: { id: ProjectId },
      payload: ProjectAutomationRequest,
      success: Project,
      error: NotFound,
    }),
  )
  .add(
    // Switching to mend-key generates the machine key if missing, so the
    // response is immediately followed by a public key the UI can show.
    HttpApiEndpoint.put("gitAuth", "/projects/:id/git-auth", {
      params: { id: ProjectId },
      payload: ProjectGitAuthRequest,
      success: Project,
      error: Schema.Union([NotFound, StoreFailure]),
    }),
  )
  .add(
    HttpApiEndpoint.put("workspaceImage", "/projects/:id/workspace-image", {
      params: { id: ProjectId },
      payload: ProjectWorkspaceImageRequest,
      success: ProjectWorkspaceImageSaveResult,
      error: Schema.Union([NotFound, SettingsFailure]),
    }),
  )
  .add(
    HttpApiEndpoint.put("applyDotfiles", "/projects/:id/apply-dotfiles", {
      params: { id: ProjectId },
      payload: ProjectApplyDotfilesRequest,
      success: Project,
      error: NotFound,
    }),
  )
  .add(
    HttpApiEndpoint.put("hotSessions", "/projects/:id/hot-sessions", {
      params: { id: ProjectId },
      payload: ProjectHotSessionsRequest,
      success: Project,
      error: NotFound,
    }),
  )
  .add(
    HttpApiEndpoint.get("hotSessionsStatus", "/projects/:id/hot-sessions", {
      params: { id: ProjectId },
      success: ProjectHotSessionsStatus,
      error: NotFound,
    }),
  )
  .add(
    // `?session=` roots the listing at that session's live worktree; absent,
    // the default branch's tree in the bare store. A session from another
    // project answers 404.
    HttpApiEndpoint.get("files", "/projects/:id/files", {
      params: { id: ProjectId },
      query: { session: Schema.optional(SessionId) },
      success: ProjectFileListing,
      error: [NotFound, StoreFailure],
    }),
  )
  .add(
    // Never errors on GitHub's behalf: a missing origin, a non-GitHub origin,
    // an absent or signed-out gh, and a rate limit are all answered as state.
    HttpApiEndpoint.get("pullRequests", "/projects/:id/pull-requests", {
      params: { id: ProjectId },
      success: ProjectPullRequests,
      error: NotFound,
    }),
  )
  .middleware(AuthMiddleware);

/**
 * The machine's Mend git key (docs/GIT-ACCESS.md). GET reads; POST generates
 * on first use ("mend keys init"). One key per machine today — the per-user
 * seam arrives with multi-tenant identity.
 */
export const gitKeysGroup = HttpApiGroup.make("gitKeys")
  .add(HttpApiEndpoint.get("show", "/keys/git", { success: GitKeyView }))
  .add(HttpApiEndpoint.post("init", "/keys/git", { success: GitKeyView, error: StoreFailure }))
  .add(HttpApiEndpoint.get("bridgeStatus", "/keys/bridge", { success: GitBridgeStatusView }))
  .middleware(AuthMiddleware);

/** Add a reference: clone `source` shallow into the store, pinned to `ref` when given. */
export class AddReference extends Schema.Class<AddReference>("AddReference")({
  name: Schema.String,
  source: Schema.String,
  /** Branch or tag to hold the clone at; null = the remote's default branch. */
  ref: Schema.NullOr(Schema.String),
}) {}

/** The project's selection, replaced as a set — what its sessions will mount. */
export class ProjectReferenceSelection extends Schema.Class<ProjectReferenceSelection>(
  "ProjectReferenceSelection",
)({
  referenceIds: Schema.Array(ReferenceId),
}) {}

/**
 * References (plan §17, decided 2026-08-01): a global list of read-only
 * dependency clones, selected per project, mounted at `/workspace/ref/<name>`.
 */
export const referencesGroup = HttpApiGroup.make("references")
  .add(HttpApiEndpoint.get("list", "/references", { success: Schema.Array(Reference) }))
  .add(
    HttpApiEndpoint.post("add", "/references", {
      payload: AddReference,
      success: Reference,
      error: StoreFailure,
    }),
  )
  .add(
    HttpApiEndpoint.delete("remove", "/references/:id", {
      params: { id: ReferenceId },
      error: NotFound,
    }),
  )
  .add(
    HttpApiEndpoint.post("refresh", "/references/:id/refresh", {
      params: { id: ReferenceId },
      success: Reference,
      error: Schema.Union([NotFound, StoreFailure]),
    }),
  )
  .add(
    HttpApiEndpoint.get("forProject", "/projects/:id/references", {
      params: { id: ProjectId },
      success: Schema.Array(Reference),
      error: NotFound,
    }),
  )
  .add(
    HttpApiEndpoint.put("selectForProject", "/projects/:id/references", {
      params: { id: ProjectId },
      payload: ProjectReferenceSelection,
      success: Schema.Array(Reference),
      error: NotFound,
    }),
  )
  .middleware(AuthMiddleware);

/** Declare a host folder the project's sessions can see; read-only unless chosen otherwise. */
export class AddProjectMount extends Schema.Class<AddProjectMount>("AddProjectMount")({
  name: Schema.String,
  hostPath: Schema.String,
  readOnly: Schema.Boolean,
}) {}

/**
 * Per-project extra mounts (plan §17, decided 2026-08-01): host folders
 * mounted at `/workspace/home/<name>` in the project's sessions. The review
 * scope is unchanged — mounts widen what the agent can see, never what Mend
 * reviews.
 */
export const projectMountsGroup = HttpApiGroup.make("projectMounts")
  .add(
    HttpApiEndpoint.get("list", "/projects/:id/mounts", {
      params: { id: ProjectId },
      success: Schema.Array(ProjectMount),
      error: NotFound,
    }),
  )
  .add(
    HttpApiEndpoint.post("add", "/projects/:id/mounts", {
      params: { id: ProjectId },
      payload: AddProjectMount,
      success: ProjectMount,
      error: Schema.Union([NotFound, StoreFailure]),
    }),
  )
  .add(
    HttpApiEndpoint.delete("remove", "/projects/:id/mounts/:mountId", {
      params: { id: ProjectId, mountId: ProjectMountId },
      error: NotFound,
    }),
  )
  .middleware(AuthMiddleware);

/** One name/value to create; ordinary configuration only — stored and returned as plaintext. */
export class ProjectEnvironmentVariableRequest extends Schema.Class<ProjectEnvironmentVariableRequest>(
  "ProjectEnvironmentVariableRequest",
)({
  name: Schema.String,
  /** Empty string is a valid value ("set to empty"). */
  value: Schema.String,
}) {}

/** Atomic edit/rename of one stable ID; requires the last-seen integer row revision. */
export class ProjectEnvironmentVariableUpdateRequest extends Schema.Class<ProjectEnvironmentVariableUpdateRequest>(
  "ProjectEnvironmentVariableUpdateRequest",
)({
  name: Schema.String,
  value: Schema.String,
  expectedRevision: Schema.Int,
}) {}

export class ProjectEnvironmentVariableRemoveRequest extends Schema.Class<ProjectEnvironmentVariableRemoveRequest>(
  "ProjectEnvironmentVariableRemoveRequest",
)({
  expectedRevision: Schema.Int,
}) {}

/** A mutation's result: the touched variable (absent after delete) + new aggregate revision. */
export class ProjectEnvironmentMutationResult extends Schema.Class<ProjectEnvironmentMutationResult>(
  "ProjectEnvironmentMutationResult",
)({
  variable: Schema.NullOr(ProjectEnvironmentVariable),
  revision: Schema.Int,
}) {}

/**
 * A refused environment write: which field broke which rule, with the same wording the UI shows.
 * Duplicates and per-project limits arrive as issues too (`duplicate-name`, `entry-count`,
 * `total-size`, with `field: null` for the aggregate ones). Values never appear.
 */
export class EnvironmentRejected extends Schema.TaggedErrorClass<EnvironmentRejected>()(
  "EnvironmentRejected",
  {
    issues: Schema.Array(
      Schema.Struct({
        field: Schema.NullOr(Schema.Literals(["name", "value"])),
        rule: Schema.String,
        message: Schema.String,
      }),
    ),
  },
  { httpApiStatus: 422 },
) {}

/** The row moved since the caller read it. The browser keeps its draft; nothing was written. */
export class EnvironmentStaleWrite extends Schema.TaggedErrorClass<EnvironmentStaleWrite>()(
  "EnvironmentStaleWrite",
  {
    variableId: Schema.String,
    currentRevision: Schema.Int,
  },
  { httpApiStatus: 409 },
) {}

/**
 * Load a `.env` into the project store (`mend env load`, the "Load a .env" panel): the raw file
 * text, parsed and routed SERVER-SIDE. Each entry goes by NAME to Configuration or Secrets — or
 * everything acceptable to Secrets with `allSecret`, or the listed `secretNames` — create-or-
 * replace by name; the file is the intent. Values cross this request only; the response never
 * carries one.
 */
export class EnvironmentLoadRequest extends Schema.Class<EnvironmentLoadRequest>(
  "EnvironmentLoadRequest",
)({
  contents: Schema.String,
  allSecret: Schema.Boolean,
  secretNames: Schema.Array(Schema.String),
}) {}

export class EnvironmentLoadedEntry extends Schema.Class<EnvironmentLoadedEntry>(
  "EnvironmentLoadedEntry",
)({
  name: Schema.String,
  lane: Schema.Literals(["configuration", "secret"]),
  /** `moved` = it also left the other lane (a name lives in exactly one). */
  action: Schema.Literals(["created", "updated", "moved"]),
}) {}

export class EnvironmentRejectedEntry extends Schema.Class<EnvironmentRejectedEntry>(
  "EnvironmentRejectedEntry",
)({
  name: Schema.String,
  reason: Schema.String,
}) {}

/** The per-name report: what landed where, and what was refused and why. Never a value. */
export class EnvironmentLoadReport extends Schema.Class<EnvironmentLoadReport>(
  "EnvironmentLoadReport",
)({
  loaded: Schema.Array(EnvironmentLoadedEntry),
  rejected: Schema.Array(EnvironmentRejectedEntry),
  /** Line numbers the parser could not read as `NAME=value`; nothing on them was stored. */
  malformedLines: Schema.Array(Schema.Int),
  environmentRevision: Schema.Int,
  secretRevision: Schema.Int,
}) {}

/**
 * Project environment variables (`.plans/project-environment-variables.md`): project-owned,
 * explicitly NON-SECRET configuration inherited by every process in the project's future
 * workspaces. Values ride only this group — project detail, session detail, and events carry
 * pointers or names, never values. Changes apply to new workspace launches (including
 * settled-session resume); a running workspace keeps what it started with.
 */

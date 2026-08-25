import {
  CheckpointId,
  ProjectEnvironmentVariableId,
  ProjectId,
  ProjectSecretId,
  ReviewCommentId,
  ReviewSliceId,
} from "@mend/domain";
import {
  AgentLaunchMode,
  EFFORT_LEVELS,
  PERMISSION_MODES,
  SPEED_MODES,
  Checkpoint,
  DiffDigest,
  ProjectEnvironmentSnapshot,
  ProjectSecret,
  ProjectSecretsSnapshot,
  ServiceBrowserScheme,
  ServiceRecipe,
  Session,
  SessionProcess,
} from "@mend/domain/workbench";
import { Change as SessionChange } from "@mend/domain/workbench";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

import { NotFound } from "./accounts.ts";
import { AuthMiddleware } from "./common.ts";
import {
  ProjectEnvironmentMutationResult,
  ProjectEnvironmentVariableRequest,
  ProjectEnvironmentVariableUpdateRequest,
  ProjectEnvironmentVariableRemoveRequest,
} from "./projects.ts";
import {
  EnvironmentLoadReport,
  EnvironmentLoadRequest,
  EnvironmentRejected,
  EnvironmentStaleWrite,
} from "./projects.ts";
import { StoreFailure } from "./workbench-views.ts";

export const projectEnvironmentGroup = HttpApiGroup.make("projectEnvironment")
  .add(
    HttpApiEndpoint.get("get", "/projects/:id/environment", {
      params: { id: ProjectId },
      success: ProjectEnvironmentSnapshot,
      error: NotFound,
    }),
  )
  .add(
    HttpApiEndpoint.post("create", "/projects/:id/environment/variables", {
      params: { id: ProjectId },
      payload: ProjectEnvironmentVariableRequest,
      success: ProjectEnvironmentMutationResult,
      // An ARRAY, not Schema.Union: the union collapses per-member httpApiStatus to 500.
      error: [NotFound, EnvironmentRejected],
    }),
  )
  .add(
    HttpApiEndpoint.put("update", "/projects/:id/environment/variables/:variableId", {
      params: { id: ProjectId, variableId: ProjectEnvironmentVariableId },
      payload: ProjectEnvironmentVariableUpdateRequest,
      success: ProjectEnvironmentMutationResult,
      error: [NotFound, EnvironmentRejected, EnvironmentStaleWrite],
    }),
  )
  .add(
    HttpApiEndpoint.delete("remove", "/projects/:id/environment/variables/:variableId", {
      params: { id: ProjectId, variableId: ProjectEnvironmentVariableId },
      payload: ProjectEnvironmentVariableRemoveRequest,
      success: ProjectEnvironmentMutationResult,
      error: [NotFound, EnvironmentStaleWrite],
    }),
  )
  .add(
    HttpApiEndpoint.post("load", "/projects/:id/environment/load", {
      params: { id: ProjectId },
      payload: EnvironmentLoadRequest,
      success: EnvironmentLoadReport,
      error: NotFound,
    }),
  )
  .middleware(AuthMiddleware);

/** Create a secret: the value is sealed at rest and never returned by any response. */
export class ProjectSecretRequest extends Schema.Class<ProjectSecretRequest>(
  "ProjectSecretRequest",
)({
  name: Schema.String,
  value: Schema.String,
}) {}

/**
 * Replace a secret's value and/or rename it. `value: null` keeps the stored value (pure rename);
 * a string replaces it. Requires the last-seen row revision.
 */
export class ProjectSecretUpdateRequest extends Schema.Class<ProjectSecretUpdateRequest>(
  "ProjectSecretUpdateRequest",
)({
  name: Schema.String,
  value: Schema.NullOr(Schema.String),
  expectedRevision: Schema.Int,
}) {}

export class ProjectSecretRemoveRequest extends Schema.Class<ProjectSecretRemoveRequest>(
  "ProjectSecretRemoveRequest",
)({
  expectedRevision: Schema.Int,
}) {}

/** A secret mutation's result: the touched row (name/revision only) + new aggregate revision. */
export class ProjectSecretMutationResult extends Schema.Class<ProjectSecretMutationResult>(
  "ProjectSecretMutationResult",
)({
  secret: Schema.NullOr(ProjectSecret),
  revision: Schema.Int,
}) {}

/**
 * Project SECRETS (`.plans/project-environment-variables.md`, "Scope expansion"): the encrypted,
 * write-only half of the project env store. Responses carry names and revisions only — a value
 * that has been written can never be read back through this API. At launch the current set goes
 * to Sealant's transient secret channel, which keeps it out of the blueprint, container env, and
 * captured output. Same lifecycle as Configuration: new workspace launches only.
 */
export const projectSecretsGroup = HttpApiGroup.make("projectSecrets")
  .add(
    HttpApiEndpoint.get("get", "/projects/:id/secrets", {
      params: { id: ProjectId },
      success: ProjectSecretsSnapshot,
      error: NotFound,
    }),
  )
  .add(
    HttpApiEndpoint.post("create", "/projects/:id/secrets", {
      params: { id: ProjectId },
      payload: ProjectSecretRequest,
      success: ProjectSecretMutationResult,
      error: [NotFound, EnvironmentRejected],
    }),
  )
  .add(
    HttpApiEndpoint.put("update", "/projects/:id/secrets/:secretId", {
      params: { id: ProjectId, secretId: ProjectSecretId },
      payload: ProjectSecretUpdateRequest,
      success: ProjectSecretMutationResult,
      error: [NotFound, EnvironmentRejected, EnvironmentStaleWrite],
    }),
  )
  .add(
    HttpApiEndpoint.delete("remove", "/projects/:id/secrets/:secretId", {
      params: { id: ProjectId, secretId: ProjectSecretId },
      payload: ProjectSecretRemoveRequest,
      success: ProjectSecretMutationResult,
      error: [NotFound, EnvironmentStaleWrite],
    }),
  )
  .middleware(AuthMiddleware);

/** Declare a Service on the project itself; command-less = adopt-only. */
export class AddProjectServiceRecipe extends Schema.Class<AddProjectServiceRecipe>(
  "AddProjectServiceRecipe",
)({
  name: Schema.String,
  command: Schema.NullOr(Schema.String),
  port: Schema.Int,
  protocol: Schema.optional(Schema.Literals(["tcp", "udp"])),
  browserScheme: Schema.optional(ServiceBrowserScheme),
}) {}

/**
 * Project-level Service recipes (docs/SESSION-SERVICES.md): the web-editable
 * twin of mend.toml, stored on this machine. Sessions see the union of both;
 * on a name collision the file wins — it travels with the repo.
 */
export const projectRecipesGroup = HttpApiGroup.make("projectRecipes")
  .add(
    HttpApiEndpoint.get("list", "/projects/:id/service-recipes", {
      params: { id: ProjectId },
      success: Schema.Array(ServiceRecipe),
      error: NotFound,
    }),
  )
  .add(
    HttpApiEndpoint.post("add", "/projects/:id/service-recipes", {
      params: { id: ProjectId },
      payload: AddProjectServiceRecipe,
      success: ServiceRecipe,
      error: [NotFound, StoreFailure],
    }),
  )
  .add(
    HttpApiEndpoint.delete("remove", "/projects/:id/service-recipes/:name", {
      params: { id: ProjectId, name: Schema.String },
      error: NotFound,
    }),
  )
  .middleware(AuthMiddleware);

/** Provisioning a session: the worktree exists after this; launching is separate. */
export class NewWorkbenchSession extends Schema.Class<NewWorkbenchSession>("NewWorkbenchSession")({
  harness: Schema.String,
  /** Intended agent launch shape; omitted keeps the PTY default. */
  mode: Schema.optional(AgentLaunchMode),
  label: Schema.NullOr(Schema.String),
  /** Branch or sha to base the worktree on; null = the project's default branch. */
  base: Schema.NullOr(Schema.String),
}) {}

export class SessionDetail extends Schema.Class<SessionDetail>("SessionDetail")({
  session: Session,
  checkpoints: Schema.Array(Checkpoint),
  change: Schema.NullOr(SessionChange),
  /** Every process the session has held, oldest first — agents, shells, Service attempts. */
  processes: Schema.Array(SessionProcess),
  /** The agent process "the session's agent" means right now; null before the first launch. */
  currentAgent: Schema.NullOr(SessionProcess),
}) {}

/** The API takes only the human-initiated triggers; the engine owns the rest. */
export class CheckpointRequest extends Schema.Class<CheckpointRequest>("CheckpointRequest")({
  trigger: Schema.Literals(["review-open", "user-mark"]),
}) {}

/** Immutable Review bundle plus the exact edited instruction and client retry key. */
export class DeliverFollowUpRequest extends Schema.Class<DeliverFollowUpRequest>(
  "DeliverFollowUpRequest",
)({
  reviewSliceId: ReviewSliceId,
  checkpointAId: CheckpointId,
  checkpointBId: CheckpointId,
  diffDigest: DiffDigest,
  commentIds: Schema.Array(ReviewCommentId),
  instruction: Schema.String,
  idempotencyKey: Schema.String,
}) {}

/**
 * What to run in the session's PTY. Two shapes: verbatim `argv` (argv[0] is
 * the program; wins when present), or the structured start — the server
 * composes the harness argv from it in one place (`composeLaunchArgv`).
 */
export class LaunchRequest extends Schema.Class<LaunchRequest>("LaunchRequest")({
  /** Omitted keeps the existing PTY launch shape. */
  mode: Schema.optional(AgentLaunchMode),
  argv: Schema.optional(Schema.Array(Schema.String)),
  /** The typed first message; rides the harness argv and seeds auto-naming. */
  prompt: Schema.optional(Schema.String),
  /** Free-form harness model id; HARNESS_MODELS is advisory, for pickers. */
  model: Schema.optional(Schema.String),
  effort: Schema.optional(Schema.Literals(EFFORT_LEVELS)),
  permissionMode: Schema.optional(Schema.Literals(PERMISSION_MODES)),
  /** `fast` = priority processing where the harness supports it (codex). */
  speed: Schema.optional(Schema.Literals(SPEED_MODES)),
}) {}

/** Submit one authored input to the live protocol process. */
export class SubmitAgentTurnRequest extends Schema.Class<SubmitAgentTurnRequest>(
  "SubmitAgentTurnRequest",
)({
  input: Schema.String,
}) {}

/** A live protocol process is required for this operation. */
export class ProtocolSessionNotLive extends Schema.TaggedErrorClass<ProtocolSessionNotLive>()(
  "ProtocolSessionNotLive",
  { processId: Schema.String },
  { httpApiStatus: 409 },
) {}

/** The request already has an observed answer or cancellation. */
export class AgentRequestResolved extends Schema.TaggedErrorClass<AgentRequestResolved>()(
  "AgentRequestResolved",
  { requestId: Schema.String },
  { httpApiStatus: 409 },
) {}

/** Approval and structured-input responses are disjoint on the wire. */

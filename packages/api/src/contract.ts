import type { AuthSession } from "@mend/auth";
import { NewIssue, QueueMove } from "@mend/db";
import {
  Brief,
  BriefComment,
  BriefVersion,
  Change,
  ChangeId,
  Issue,
  IssueId,
  MendSettings,
  ProjectId,
  ProjectMountId,
  ReferenceId,
  ReviewCommentId,
  Run,
  RunId,
  SessionId,
  SessionProcessId,
  WorkspaceImage,
} from "@mend/domain";
import {
  AutomationChoice,
  Change as SessionChange,
  ChangePass,
  ChangeTour,
  Checkpoint,
  FollowUp,
  GitAuthMode,
  Project,
  ProjectMount,
  Reference,
  ReviewComment,
  ServiceRecipe,
  Session,
  SessionProcess,
} from "@mend/domain/workbench";
import { SealantConnection } from "@mend/sealant";
import { Schema } from "effect";
import * as Context from "effect/Context";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware } from "effect/unstable/httpapi";

/**
 * The Mend API contract — one Effect HttpApi served from the product process,
 * consumed by the web app (SSR loaders and client) and later the mobile app.
 * Contract first: this module is pure data; the server implementation lives in
 * ./server.ts, and clients derive themselves from what is declared here.
 */

export class Unauthorized extends Schema.TaggedErrorClass<Unauthorized>()(
  "Unauthorized",
  {},
  { httpApiStatus: 401 },
) {}

/** Who is signed in, provided to protected endpoints by the auth middleware. */
export class CurrentUser extends Context.Service<CurrentUser, AuthSession>()(
  "@mend/api/CurrentUser",
) {}

/** Cookie session (web) or bearer token (mobile) — both resolve through better-auth. */
export class AuthMiddleware extends HttpApiMiddleware.Service<
  AuthMiddleware,
  { provides: CurrentUser }
>()("@mend/api/AuthMiddleware", {
  error: Unauthorized,
}) {}

export class HealthStatus extends Schema.Class<HealthStatus>("HealthStatus")({
  status: Schema.Literals(["ok"]),
  version: Schema.String,
}) {}

const healthGroup = HttpApiGroup.make("health").add(
  HttpApiEndpoint.get("status", "/health", { success: HealthStatus }),
);

/** The settings page's connection check — reports what was observed, never a judgment. */
const sealantGroup = HttpApiGroup.make("sealant")
  .add(HttpApiEndpoint.get("connection", "/sealant/connection", { success: SealantConnection }))
  .middleware(AuthMiddleware);

export class NotFound extends Schema.TaggedErrorClass<NotFound>()(
  "NotFound",
  { id: Schema.String },
  { httpApiStatus: 404 },
) {}

export class IssueDetail extends Schema.Class<IssueDetail>("IssueDetail")({
  issue: Issue,
  runs: Schema.Array(Run),
}) {}

/** One terminal command the run executed, from the SDK's read surface. */
export class RunCommandView extends Schema.Class<RunCommandView>("RunCommandView")({
  command: Schema.String,
  exitCode: Schema.NullOr(Schema.Int),
  durationMs: Schema.NullOr(Schema.Number),
}) {}

/** A telemetry gap, straight from the record's loss report — never fabricated. */
export class LossSpanView extends Schema.Class<LossSpanView>("LossSpanView")({
  fromSequence: Schema.NullOr(Schema.String),
  toSequence: Schema.NullOr(Schema.String),
}) {}

/** Provenance-honest: `complete` or the exact spans that were dropped. */
export class LossReportView extends Schema.Class<LossReportView>("LossReportView")({
  complete: Schema.Boolean,
  spans: Schema.Array(LossSpanView),
}) {}

/**
 * The run detail: the indexed row plus what the record can already show
 * (commands · transcript · loss). `recordError` carries the observed failure
 * when the recording could not be read — a gap is content, not an omission.
 */
export class RunDetail extends Schema.Class<RunDetail>("RunDetail")({
  run: Run,
  commands: Schema.Array(RunCommandView),
  transcript: Schema.NullOr(Schema.String),
  loss: Schema.NullOr(LossReportView),
  recordError: Schema.NullOr(Schema.String),
}) {}

/** One timeline entry of the full trace, summary-first (typed data stays platform-side). */
export class TraceEntryView extends Schema.Class<TraceEntryView>("TraceEntryView")({
  sequence: Schema.String,
  occurredAt: Schema.String,
  kind: Schema.String,
  summary: Schema.String,
  processId: Schema.NullOr(Schema.String),
}) {}

/** A page of the full trace; `nextFrom` resumes where this page ended. */
export class TracePage extends Schema.Class<TracePage>("TracePage")({
  entries: Schema.Array(TraceEntryView),
  nextFrom: Schema.NullOr(Schema.String),
}) {}

/** One network source the run touched, aggregated from the record's source events. */
export class RunSourceView extends Schema.Class<RunSourceView>("RunSourceView")({
  host: Schema.String,
  method: Schema.NullOr(Schema.String),
  path: Schema.NullOr(Schema.String),
  status: Schema.NullOr(Schema.Int),
  count: Schema.Int,
  firstSequence: Schema.String,
}) {}

/** The queue: list, manual entry into triage, the Gate 1 drag, the detail views. */
const issuesGroup = HttpApiGroup.make("issues")
  .add(HttpApiEndpoint.get("list", "/issues", { success: Schema.Array(Issue) }))
  .add(HttpApiEndpoint.post("create", "/issues", { payload: NewIssue, success: Issue }))
  .add(
    HttpApiEndpoint.get("detail", "/issues/:id", {
      params: { id: IssueId },
      success: IssueDetail,
      error: NotFound,
    }),
  )
  .add(
    HttpApiEndpoint.post("move", "/issues/:id/move", {
      params: { id: IssueId },
      payload: QueueMove,
      success: Issue,
      error: NotFound,
    }),
  )
  .middleware(AuthMiddleware);

/** The living brief with the change it belongs to — one per issue at most. */
export class BriefDetail extends Schema.Class<BriefDetail>("BriefDetail")({
  brief: Brief,
  change: Change,
}) {}

/** A reviewer's comment as posted: the thread it anchors to, and the words. */
export class NewBriefComment extends Schema.Class<NewBriefComment>("NewBriefComment")({
  /** `q<index>` anchors a review question; `general` is the brief-wide thread. */
  thread: Schema.String,
  body: Schema.String,
}) {}

const briefsGroup = HttpApiGroup.make("briefs")
  .add(
    HttpApiEndpoint.get("byIssue", "/issues/:id/brief", {
      params: { id: IssueId },
      success: BriefDetail,
      error: NotFound,
    }),
  )
  .add(
    HttpApiEndpoint.get("comments", "/issues/:id/brief/comments", {
      params: { id: IssueId },
      success: Schema.Array(BriefComment),
      error: NotFound,
    }),
  )
  .add(
    HttpApiEndpoint.post("comment", "/issues/:id/brief/comments", {
      params: { id: IssueId },
      payload: NewBriefComment,
      success: BriefComment,
      error: NotFound,
    }),
  )
  .add(
    HttpApiEndpoint.get("versions", "/issues/:id/brief/versions", {
      params: { id: IssueId },
      success: Schema.Array(BriefVersion),
      error: NotFound,
    }),
  )
  .middleware(AuthMiddleware);

const runsGroup = HttpApiGroup.make("runs")
  .add(
    HttpApiEndpoint.get("detail", "/runs/:id", {
      params: { id: RunId },
      success: RunDetail,
      error: NotFound,
    }),
  )
  .add(
    HttpApiEndpoint.get("trace", "/runs/:id/trace", {
      params: { id: RunId },
      query: { from: Schema.optional(Schema.String) },
      success: TracePage,
      error: NotFound,
    }),
  )
  .add(
    HttpApiEndpoint.get("sources", "/runs/:id/sources", {
      params: { id: RunId },
      success: Schema.Array(RunSourceView),
      error: NotFound,
    }),
  )
  .middleware(AuthMiddleware);

// ─── Workbench (MEND-AGENT-WORKBENCH-PLAN.md §5–§7) ─────────────────────────

/** A store or git operation that could not complete — the observed reason, verbatim. */
export class StoreFailure extends Schema.TaggedErrorClass<StoreFailure>()(
  "StoreFailure",
  { message: Schema.String },
  { httpApiStatus: 422 },
) {}

/** A settings update that could not be validated or persisted — the observed reason. */
export class SettingsFailure extends Schema.TaggedErrorClass<SettingsFailure>()(
  "SettingsFailure",
  { message: Schema.String },
  { httpApiStatus: 422 },
) {}

/**
 * Adoption: clone `source` (URL or local path) into the store under `name`.
 * `source` is any git URL — GitHub, GitLab, self-hosted, ssh://, a local path.
 * Omitted `gitAuthMode` means `ambient` (the login user's git setup).
 */
export class AdoptProject extends Schema.Class<AdoptProject>("AdoptProject")({
  name: Schema.String,
  source: Schema.String,
  gitAuthMode: Schema.optional(GitAuthMode),
}) {}

/**
 * List decoration for one session — the DB-cheap review facts (plan §6.1:
 * "which local changes have not been reviewed"). Diff stats stay behind
 * /changes/:id/stats; git is never spawned for a list.
 */
export class SessionAnnotation extends Schema.Class<SessionAnnotation>("SessionAnnotation")({
  sessionId: Schema.String,
  changeId: Schema.NullOr(ChangeId),
  openComments: Schema.Int,
  totalComments: Schema.Int,
  pendingFollowUp: Schema.Boolean,
}) {}

export class ProjectDetail extends Schema.Class<ProjectDetail>("ProjectDetail")({
  project: Project,
  sessions: Schema.Array(Session),
  annotations: Schema.Array(SessionAnnotation),
}) {}

/** The outcome of a destructive removal — what went, what would not. */
export class RemovalReport extends Schema.Class<RemovalReport>("RemovalReport")({
  removed: Schema.Boolean,
  leftover: Schema.NullOr(Schema.String),
}) {}

/** Deleting a live session is refused — stop it first. */
export class SessionActive extends Schema.TaggedErrorClass<SessionActive>()(
  "SessionActive",
  { id: Schema.String },
  { httpApiStatus: 409 },
) {}

/** A shell needs a live workspace — a settled session has none; resume it first. */
export class SessionNotLive extends Schema.TaggedErrorClass<SessionNotLive>()(
  "SessionNotLive",
  { id: Schema.String },
  { httpApiStatus: 409 },
) {}

/** The project's stance on the review-automation switches — both, replaced together. */
export class ProjectAutomationRequest extends Schema.Class<ProjectAutomationRequest>(
  "ProjectAutomationRequest",
)({
  autoTour: AutomationChoice,
  autoSuggest: AutomationChoice,
}) {}

/** How host-side git reaches this project's remote (docs/GIT-ACCESS.md). */
export class ProjectGitAuthRequest extends Schema.Class<ProjectGitAuthRequest>(
  "ProjectGitAuthRequest",
)({
  gitAuthMode: GitAuthMode,
}) {}

/**
 * The machine's Mend deploy key — public half only; the private key never
 * leaves the host and never crosses this API. `exists: false` is status, not
 * an error: no key has been generated yet.
 */
export class GitKeyView extends Schema.Class<GitKeyView>("GitKeyView")({
  exists: Schema.Boolean,
  publicKey: Schema.NullOr(Schema.String),
  fingerprint: Schema.NullOr(Schema.String),
}) {}

export const HostToolSuggestionView = Schema.Struct({
  executable: Schema.String,
  kind: Schema.Literals(["package", "service"]),
  id: Schema.String,
});

export const HostConfigSuggestionView = Schema.Struct({
  label: Schema.String,
  path: Schema.String,
});

export const HostEnvironmentSuggestionsView = Schema.Struct({
  tools: Schema.Array(HostToolSuggestionView),
  configs: Schema.Array(HostConfigSuggestionView),
});

export class WorkspacePackageResolutionView extends Schema.Class<WorkspacePackageResolutionView>(
  "WorkspacePackageResolutionView",
)({
  requested: Schema.String,
  normalized: Schema.String,
  status: Schema.Literals(["resolved", "ambiguous", "unsupported", "not-found", "invalid"]),
  canonicalId: Schema.NullOr(Schema.String),
  supported: Schema.Boolean,
  packageName: Schema.NullOr(Schema.String),
  alternatives: Schema.Array(Schema.String),
}) {}

export class WorkspaceEnvironmentSaveResult extends Schema.Class<WorkspaceEnvironmentSaveResult>(
  "WorkspaceEnvironmentSaveResult",
)({
  saved: Schema.Boolean,
  settings: MendSettings,
  resolutions: Schema.Array(WorkspacePackageResolutionView),
}) {}

/**
 * Product settings, one document (the review-automation cascade's root:
 * project `inherit` resolves against these defaults). PUT replaces the whole
 * document — clients edit what GET returned.
 */
const settingsGroup = HttpApiGroup.make("settings")
  .add(HttpApiEndpoint.get("get", "/settings", { success: MendSettings }))
  .add(
    HttpApiEndpoint.get("scanHostEnvironment", "/settings/environment-suggestions", {
      success: HostEnvironmentSuggestionsView,
    }),
  )
  .add(
    HttpApiEndpoint.put("set", "/settings", {
      payload: MendSettings,
      success: MendSettings,
      error: SettingsFailure,
    }),
  )
  .add(
    HttpApiEndpoint.put("setWorkspaceEnvironment", "/settings/workspace-environment", {
      payload: WorkspaceImage,
      success: WorkspaceEnvironmentSaveResult,
      error: SettingsFailure,
    }),
  )
  .middleware(AuthMiddleware);

const projectsGroup = HttpApiGroup.make("projects")
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
      error: NotFound,
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
  .middleware(AuthMiddleware);

/**
 * The machine's Mend git key (docs/GIT-ACCESS.md). GET reads; POST generates
 * on first use ("mend keys init"). One key per machine today — the per-user
 * seam arrives with multi-tenant identity.
 */
const gitKeysGroup = HttpApiGroup.make("gitKeys")
  .add(HttpApiEndpoint.get("show", "/keys/git", { success: GitKeyView }))
  .add(HttpApiEndpoint.post("init", "/keys/git", { success: GitKeyView, error: StoreFailure }))
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
const referencesGroup = HttpApiGroup.make("references")
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
const projectMountsGroup = HttpApiGroup.make("projectMounts")
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

/** Declare a Service on the project itself; command-less = adopt-only. */
export class AddProjectServiceRecipe extends Schema.Class<AddProjectServiceRecipe>(
  "AddProjectServiceRecipe",
)({
  name: Schema.String,
  command: Schema.NullOr(Schema.String),
  port: Schema.Int,
  protocol: Schema.optional(Schema.Literals(["tcp", "udp"])),
}) {}

/**
 * Project-level Service recipes (docs/SESSION-SERVICES.md): the web-editable
 * twin of mend.toml, stored on this machine. Sessions see the union of both;
 * on a name collision the file wins — it travels with the repo.
 */
const projectRecipesGroup = HttpApiGroup.make("projectRecipes")
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
      error: Schema.Union([NotFound, StoreFailure]),
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
  label: Schema.NullOr(Schema.String),
  /** Branch or sha to base the worktree on; null = the project's default branch. */
  base: Schema.NullOr(Schema.String),
}) {}

export class SessionDetail extends Schema.Class<SessionDetail>("SessionDetail")({
  session: Session,
  checkpoints: Schema.Array(Checkpoint),
  change: Schema.NullOr(SessionChange),
}) {}

/** The API takes only the human-initiated triggers; the engine owns the rest. */
export class CheckpointRequest extends Schema.Class<CheckpointRequest>("CheckpointRequest")({
  trigger: Schema.Literals(["review-open", "user-mark"]),
}) {}

/** The instruction exactly as the user edited it in the send-review dialog. */
export class NewFollowUp extends Schema.Class<NewFollowUp>("NewFollowUp")({
  instruction: Schema.String,
}) {}

/** What to run in the session's PTY — argv[0] is the program. */
export class LaunchRequest extends Schema.Class<LaunchRequest>("LaunchRequest")({
  argv: Schema.Array(Schema.String),
}) {}

/** One conversation event of the canonical session record (chat surfaces render these). */
export class TranscriptEvent extends Schema.Class<TranscriptEvent>("TranscriptEvent")({
  kind: Schema.String,
  text: Schema.NullOr(Schema.String),
  name: Schema.NullOr(Schema.String),
  command: Schema.NullOr(Schema.String),
  output: Schema.NullOr(Schema.String),
}) {}

export class SessionTranscript extends Schema.Class<SessionTranscript>("SessionTranscript")({
  sourceHarness: Schema.String,
  events: Schema.Array(TranscriptEvent),
}) {}

/** Rejoin a settled session; `harness` null = the one it last ran with. */
export class ResumeRequest extends Schema.Class<ResumeRequest>("ResumeRequest")({
  harness: Schema.NullOr(Schema.String),
}) {}

const sessionsGroup = HttpApiGroup.make("sessions")
  .add(HttpApiEndpoint.get("listActive", "/sessions", { success: Schema.Array(Session) }))
  .add(
    HttpApiEndpoint.post("create", "/projects/:id/sessions", {
      params: { id: ProjectId },
      payload: NewWorkbenchSession,
      success: Session,
      error: Schema.Union([NotFound, StoreFailure]),
    }),
  )
  .add(
    HttpApiEndpoint.get("detail", "/sessions/:id", {
      params: { id: SessionId },
      success: SessionDetail,
      error: NotFound,
    }),
  )
  .add(
    // The plural process record (docs/SESSION-SERVICES.md): every PTY in the
    // session's workspace — agent, shells, Services — each addressable at the
    // TTY route via `?process=<id>`.
    HttpApiEndpoint.get("listProcesses", "/sessions/:id/processes", {
      params: { id: SessionId },
      success: Schema.Array(SessionProcess),
      error: NotFound,
    }),
  )
  .add(
    // The second pane (docs/SESSION-SERVICES.md): a shell PTY beside the
    // agent in the session's live workspace. Attach at /api/tty?process=<id>.
    HttpApiEndpoint.post("openShell", "/sessions/:id/shell", {
      params: { id: SessionId },
      success: SessionProcess,
      error: Schema.Union([NotFound, SessionNotLive, StoreFailure]),
    }),
  )
  .add(
    // Adopt an already-listening workspace port as a Service
    // (docs/SESSION-SERVICES.md): Mend binds a host port on the private
    // interfaces and pumps each connection over a workspace forward.
    HttpApiEndpoint.post("addService", "/sessions/:id/services", {
      params: { id: SessionId },
      payload: Schema.Struct({
        port: Schema.Int,
        name: Schema.NullOr(Schema.String),
        protocol: Schema.optional(Schema.Literals(["tcp", "udp"])),
      }),
      success: SessionProcess,
      error: Schema.Union([NotFound, SessionNotLive, StoreFailure]),
    }),
  )
  .add(
    // Start and supervise a Service: a PTY-backed command in the session's
    // workspace, awaited until the declared port answers.
    HttpApiEndpoint.post("runService", "/sessions/:id/services/run", {
      params: { id: SessionId },
      payload: Schema.Struct({
        argv: Schema.Array(Schema.String),
        port: Schema.Int,
        name: Schema.NullOr(Schema.String),
        protocol: Schema.optional(Schema.Literals(["tcp", "udp"])),
      }),
      success: SessionProcess,
      error: Schema.Union([NotFound, SessionNotLive, StoreFailure]),
    }),
  )
  .add(
    // The worktree's declared Services (mend.toml): recipes, never processes.
    HttpApiEndpoint.get("listRecipes", "/sessions/:id/recipes", {
      params: { id: SessionId },
      success: Schema.Array(ServiceRecipe),
      error: Schema.Union([NotFound, StoreFailure]),
    }),
  )
  .add(
    // What is running right now, across every session — one list, any device.
    // ?all=1 includes recently ended Services (post-mortem logs address them).
    HttpApiEndpoint.get("listServices", "/services", {
      query: { all: Schema.optional(Schema.String) },
      success: Schema.Array(SessionProcess),
    }),
  )
  .add(
    // A process's recorded output — the record outlives the process AND the
    // workspace, so a dead Service's logs stay readable.
    HttpApiEndpoint.get("processOutput", "/processes/:id/output", {
      params: { id: SessionProcessId },
      success: Schema.Struct({ text: Schema.String }),
      error: Schema.Union([NotFound, StoreFailure]),
    }),
  )
  .add(
    // Re-run the recorded command: same row, same host port, same URL.
    HttpApiEndpoint.post("restartService", "/services/:id/restart", {
      params: { id: SessionProcessId },
      success: SessionProcess,
      error: Schema.Union([NotFound, StoreFailure]),
    }),
  )
  .add(
    HttpApiEndpoint.post("stopService", "/services/:id/stop", {
      params: { id: SessionProcessId },
      success: SessionProcess,
      error: NotFound,
    }),
  )
  .add(
    // Settled sessions only — a live one answers 409; stop it first. Takes
    // the worktree with it; checkpoints' refs survive in the bare repo.
    HttpApiEndpoint.delete("remove", "/sessions/:id", {
      params: { id: SessionId },
      success: RemovalReport,
      error: Schema.Union([NotFound, SessionActive]),
    }),
  )
  .add(
    HttpApiEndpoint.post("label", "/sessions/:id/label", {
      params: { id: SessionId },
      payload: Schema.Struct({ label: Schema.NullOr(Schema.String) }),
      success: Session,
      error: NotFound,
    }),
  )
  .add(
    HttpApiEndpoint.post("stop", "/sessions/:id/stop", {
      params: { id: SessionId },
      success: Session,
      error: NotFound,
    }),
  )
  .add(
    HttpApiEndpoint.post("checkpoint", "/sessions/:id/checkpoints", {
      params: { id: SessionId },
      payload: CheckpointRequest,
      success: Checkpoint,
      error: Schema.Union([NotFound, StoreFailure]),
    }),
  )
  .add(
    // The supervised launch (SDK 0.7.0): workspace mounts the worktree,
    // a PTY session runs argv inside it, supervision attaches — the record
    // begins here.
    HttpApiEndpoint.post("launch", "/sessions/:id/launch", {
      params: { id: SessionId },
      payload: LaunchRequest,
      success: Session,
      error: Schema.Union([NotFound, StoreFailure]),
    }),
  )
  .add(
    // Sessions are continuous work: rejoin one on a fresh workspace — same
    // worktree, restored harness state, native resume where the harness
    // supports it; a different harness receives the distilled conversation.
    HttpApiEndpoint.get("transcript", "/sessions/:id/transcript", {
      params: { id: SessionId },
      success: SessionTranscript,
      error: NotFound,
    }),
  )
  .add(
    HttpApiEndpoint.post("resume", "/sessions/:id/resume", {
      params: { id: SessionId },
      payload: ResumeRequest,
      success: Session,
      error: Schema.Union([NotFound, StoreFailure]),
    }),
  )
  .add(
    // The review bundle, as the user approved it. Creating it marks the
    // change's unsent open comments as sent with this follow-up.
    HttpApiEndpoint.post("followUpCreate", "/sessions/:id/follow-up", {
      params: { id: SessionId },
      payload: NewFollowUp,
      success: FollowUp,
      error: NotFound,
    }),
  )
  .add(
    HttpApiEndpoint.get("followUpPending", "/sessions/:id/follow-up", {
      params: { id: SessionId },
      success: Schema.NullOr(FollowUp),
      error: NotFound,
    }),
  )
  .add(
    // `mend continue` picks the bundle up: marks it delivered and reopens the session.
    HttpApiEndpoint.post("followUpDeliver", "/sessions/:id/follow-up/deliver", {
      params: { id: SessionId },
      success: FollowUp,
      error: NotFound,
    }),
  )
  .middleware(AuthMiddleware);

export class ChangedFileView extends Schema.Class<ChangedFileView>("ChangedFileView")({
  path: Schema.String,
  additions: Schema.Int,
  deletions: Schema.Int,
}) {}

/** The change and its live diff — git is the source of truth, read at request time. */
export class ChangeDiff extends Schema.Class<ChangeDiff>("ChangeDiff")({
  change: SessionChange,
  diff: Schema.String,
  files: Schema.Array(ChangedFileView),
}) {}

/** A reviewer's comment: file/line anchor (both null = change-level), and the words. */
export class NewReviewCommentRequest extends Schema.Class<NewReviewCommentRequest>(
  "NewReviewCommentRequest",
)({
  file: Schema.NullOr(Schema.String),
  line: Schema.NullOr(Schema.Int),
  /** Inclusive range end; omitted/null = single-line anchor. */
  endLine: Schema.optional(Schema.NullOr(Schema.Int)),
  body: Schema.String,
}) {}

/**
 * A reviewer's disposition on an existing comment. `draft` is absent by
 * design — it belongs to Mend-authored findings and is machine-set only.
 */
export class SetCommentStateRequest extends Schema.Class<SetCommentStateRequest>(
  "SetCommentStateRequest",
)({
  state: Schema.Literals(["open", "addressed", "dismissed"]),
}) {}

/** Diff stats without the diff — cheap enough for a visible list row. */
export class ChangeStats extends Schema.Class<ChangeStats>("ChangeStats")({
  files: Schema.Int,
  additions: Schema.Int,
  deletions: Schema.Int,
}) {}

const sessionChangesGroup = HttpApiGroup.make("sessionChanges")
  .add(
    HttpApiEndpoint.get("diff", "/changes/:id/diff", {
      params: { id: ChangeId },
      success: ChangeDiff,
      error: Schema.Union([NotFound, StoreFailure]),
    }),
  )
  .add(
    HttpApiEndpoint.get("stats", "/changes/:id/stats", {
      params: { id: ChangeId },
      success: ChangeStats,
      error: Schema.Union([NotFound, StoreFailure]),
    }),
  )
  .add(
    HttpApiEndpoint.get("comments", "/changes/:id/comments", {
      params: { id: ChangeId },
      success: Schema.Array(ReviewComment),
      error: NotFound,
    }),
  )
  .add(
    HttpApiEndpoint.post("comment", "/changes/:id/comments", {
      params: { id: ChangeId },
      payload: NewReviewCommentRequest,
      success: ReviewComment,
      error: NotFound,
    }),
  )
  .add(
    HttpApiEndpoint.post("commentState", "/changes/:id/comments/:commentId/state", {
      params: { id: ChangeId, commentId: ReviewCommentId },
      payload: SetCommentStateRequest,
      success: ReviewComment,
      error: NotFound,
    }),
  )
  .add(
    // "Read this change" (plan §7.3): queue the machine pass; findings land
    // asynchronously as draft comments and arrive over the normal SSE path.
    HttpApiEndpoint.post("read", "/changes/:id/read", {
      params: { id: ChangeId },
      success: Schema.Struct({ queued: Schema.Boolean }),
      error: NotFound,
    }),
  )
  .add(
    // The composed review tour: null until composed; SSE announces arrival.
    HttpApiEndpoint.get("tour", "/changes/:id/tour", {
      params: { id: ChangeId },
      success: Schema.NullOr(ChangeTour),
      error: NotFound,
    }),
  )
  .add(
    HttpApiEndpoint.post("composeTour", "/changes/:id/tour", {
      params: { id: ChangeId },
      success: Schema.Struct({ queued: Schema.Boolean }),
      error: NotFound,
    }),
  )
  .add(
    // The suggestion pass: queue it; suggestions land asynchronously as
    // draft comments carrying exact replacements, over the normal SSE path.
    HttpApiEndpoint.post("suggest", "/changes/:id/suggest", {
      params: { id: ChangeId },
      success: Schema.Struct({ queued: Schema.Boolean }),
      error: NotFound,
    }),
  )
  .add(
    // What ran over this change and what came of it — one row per pass kind.
    HttpApiEndpoint.get("passes", "/changes/:id/passes", {
      params: { id: ChangeId },
      success: Schema.Array(ChangePass),
      error: NotFound,
    }),
  )
  .middleware(AuthMiddleware);

/**
 * Adoption discovery: the host's GitHub CLI answers with the credentials it
 * already holds — Mend adds none of its own. What was observed about gh
 * (missing, signed out) is status content, never a hidden error; clients fall
 * back to a typed source. No new product noun — this is still adoption.
 */
export class GhStatusView extends Schema.Class<GhStatusView>("GhStatusView")({
  available: Schema.Boolean,
  authenticated: Schema.Boolean,
  /** The account gh reports as active, when signed in. */
  login: Schema.NullOr(Schema.String),
  /** The CLI's own words when discovery cannot serve — verbatim, never rephrased. */
  detail: Schema.NullOr(Schema.String),
}) {}

/** One repository exactly as gh reported it (list and search shapes normalized). */
export class GhRepoView extends Schema.Class<GhRepoView>("GhRepoView")({
  nameWithOwner: Schema.String,
  description: Schema.NullOr(Schema.String),
  visibility: Schema.String,
  isFork: Schema.Boolean,
  language: Schema.NullOr(Schema.String),
  stars: Schema.Int,
  pushedAt: Schema.NullOr(Schema.String),
  url: Schema.String,
}) {}

/** A gh invocation that could not answer — its stderr, verbatim. */
export class GhFailure extends Schema.TaggedErrorClass<GhFailure>()(
  "GhFailure",
  { message: Schema.String },
  { httpApiStatus: 422 },
) {}

const githubGroup = HttpApiGroup.make("github")
  .add(HttpApiEndpoint.get("status", "/github/status", { success: GhStatusView }))
  .add(
    HttpApiEndpoint.get("repos", "/github/repos", {
      query: { query: Schema.optional(Schema.String) },
      success: Schema.Array(GhRepoView),
      error: GhFailure,
    }),
  )
  .middleware(AuthMiddleware);

/** An Expo push token registration — one per app install, token is identity. */
export class RegisterDeviceRequest extends Schema.Class<RegisterDeviceRequest>(
  "RegisterDeviceRequest",
)({
  token: Schema.String,
  platform: Schema.String,
}) {}

export class RegisteredDevice extends Schema.Class<RegisteredDevice>("RegisteredDevice")({
  token: Schema.String,
  platform: Schema.String,
}) {}

const devicesGroup = HttpApiGroup.make("devices")
  .add(
    HttpApiEndpoint.post("register", "/devices", {
      payload: RegisterDeviceRequest,
      success: RegisteredDevice,
    }),
  )
  .add(
    HttpApiEndpoint.delete("unregister", "/devices/:token", {
      params: { token: Schema.String },
    }),
  )
  .middleware(AuthMiddleware);

export const MendApi = HttpApi.make("mend")
  .add(healthGroup)
  .add(sealantGroup)
  .add(settingsGroup)
  .add(issuesGroup)
  .add(briefsGroup)
  .add(runsGroup)
  .add(projectsGroup)
  .add(gitKeysGroup)
  .add(projectMountsGroup)
  .add(projectRecipesGroup)
  .add(referencesGroup)
  .add(sessionsGroup)
  .add(sessionChangesGroup)
  .add(githubGroup)
  .add(devicesGroup)
  .prefix("/api");

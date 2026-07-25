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
  ProjectId,
  Run,
  RunId,
  SessionId,
} from "@mend/domain";
import {
  Change as SessionChange,
  Checkpoint,
  Project,
  ReviewComment,
  Session,
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

/** Adoption: clone `source` (URL or local path) into the store under `name`. */
export class AdoptProject extends Schema.Class<AdoptProject>("AdoptProject")({
  name: Schema.String,
  source: Schema.String,
}) {}

export class ProjectDetail extends Schema.Class<ProjectDetail>("ProjectDetail")({
  project: Project,
  sessions: Schema.Array(Session),
}) {}

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
  body: Schema.String,
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
  .middleware(AuthMiddleware);

export const MendApi = HttpApi.make("mend")
  .add(healthGroup)
  .add(sealantGroup)
  .add(issuesGroup)
  .add(briefsGroup)
  .add(runsGroup)
  .add(projectsGroup)
  .add(sessionsGroup)
  .add(sessionChangesGroup)
  .prefix("/api");

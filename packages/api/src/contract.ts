import type { AuthSession } from "@mend/auth";
import { NewIssue, QueueMove } from "@mend/db";
import { Issue, IssueId, Run, RunId } from "@mend/domain";
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

/**
 * The run detail: the indexed row plus what the record can already show
 * (commands · transcript). `recordError` carries the observed failure when the
 * recording could not be read — a gap is content, not an omission.
 */
export class RunDetail extends Schema.Class<RunDetail>("RunDetail")({
  run: Run,
  commands: Schema.Array(RunCommandView),
  transcript: Schema.NullOr(Schema.String),
  recordError: Schema.NullOr(Schema.String),
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

const runsGroup = HttpApiGroup.make("runs")
  .add(
    HttpApiEndpoint.get("detail", "/runs/:id", {
      params: { id: RunId },
      success: RunDetail,
      error: NotFound,
    }),
  )
  .middleware(AuthMiddleware);

export const MendApi = HttpApi.make("mend")
  .add(healthGroup)
  .add(sealantGroup)
  .add(issuesGroup)
  .add(runsGroup)
  .prefix("/api");

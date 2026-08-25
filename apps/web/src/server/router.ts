import {
  BriefDetail,
  EnvironmentLoadReport,
  EnvironmentRejected,
  EnvironmentStaleWrite,
  ProjectEnvironmentMutationResult,
  ProjectSecretMutationResult,
  HostEnvironmentSuggestionsView,
  ChangeDiff,
  ChangeStats,
  DeliverFollowUpRequest,
  DotfilesRepositoryRequest,
  DotfilesSnapshotRequest,
  DotfilesView,
  GitBridgeStatusView,
  GitKeyView,
  HealthStatus,
  IssueDetail,
  LaunchRequest,
  SliceCommentTargetRequest,
  MachineView,
  OpenReviewResult,
  PairingView,
  ProjectDetail,
  ProjectHotSessionsStatus,
  ProjectWorkspaceImageSaveResult,
  DeviceView,
  RemovalReport,
  ReviewDiffView,
  RunDetail,
  RunSourceView,
  SessionDetail,
  SessionTranscript,
  TracePage,
  WorkspaceEnvironmentSaveResult,
} from "@mend/api-contracts";
import { BriefComment, BriefVersion, Issue, MendSettings, WorkspaceImage } from "@mend/domain";
import {
  AutomationChoice,
  ProjectEnvironmentSnapshot,
  ProjectSecretsSnapshot,
  ChangePass,
  ChangeTour,
  Checkpoint,
  FollowUp,
  GitAuthMode,
  Project,
  Reference,
  ProjectMount,
  ReviewComment,
  ServiceRecipe,
  ServiceView,
  Session,
  SessionProcess,
} from "@mend/domain/workbench";
import { ConnectedAccount, SealantConnection, SealantIdentity } from "@mend/sealant";
import { initTRPC, TRPCError } from "@trpc/server";
import { Schema } from "effect";

/**
 * The web tier's tRPC surface (plan: the UI never calls the API directly).
 * Every procedure forwards to the Mend API server with the caller's
 * credentials, VALIDATES the response by decoding it through the wire
 * contract (@mend/api-contracts / @mend/domain — the same schemas the API
 * encodes with), and returns the wire JSON typed as the schema's Encoded
 * side. One source of truth: a drifted response fails loudly here instead
 * of silently mistyping the UI.
 *
 * Raw data planes stay OUTSIDE tRPC by design: the terminal WebSocket
 * (/api/tty), the service tunnel, the keys bridge, and the SSE event stream
 * are held connections that tRPC's request/response model does not fit; the
 * web server proxies them verbatim.
 */

export interface TrpcContext {
  /** The incoming request's headers — cookie/authorization forwarded to the API. */
  readonly headers: Headers;
  readonly apiUrl: string;
}

const t = initTRPC.context<TrpcContext>().create();

/** Effect Schema speaks Standard Schema v1, which tRPC v11 accepts natively. */
const input = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) =>
  Schema.toStandardSchemaV1(schema);

const statusToCode = (status: number) =>
  status === 401
    ? ("UNAUTHORIZED" as const)
    : status === 403
      ? ("FORBIDDEN" as const)
      : status === 404
        ? ("NOT_FOUND" as const)
        : status === 409
          ? ("CONFLICT" as const)
          : status < 500
            ? ("BAD_REQUEST" as const)
            : ("INTERNAL_SERVER_ERROR" as const);

interface CallOptions {
  readonly method?: "GET" | "POST" | "PUT" | "DELETE";
  readonly body?: unknown;
}

/** The raw forward: the caller's credentials ride along; nothing else does. */
const apiFetch = (ctx: TrpcContext, path: string, options: CallOptions = {}): Promise<Response> => {
  const headers = new Headers();
  const cookie = ctx.headers.get("cookie");
  const authorization = ctx.headers.get("authorization");
  if (cookie !== null) headers.set("cookie", cookie);
  if (authorization !== null) headers.set("authorization", authorization);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  return fetch(ctx.apiUrl + path, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
};

const readResponse = async <S extends Schema.Top & Schema.ConstraintDecoder<unknown>>(
  response: Response,
  path: string,
  schema: S | null,
  options: CallOptions,
): Promise<S["Encoded"]> => {
  if (!response.ok) {
    let message = `${options.method ?? "GET"} ${path} responded ${response.status}`;
    try {
      const body: { readonly message?: unknown } = await response.json();
      if (typeof body.message === "string") message = body.message;
    } catch {
      // not JSON — keep the status line
    }
    throw new TRPCError({ code: statusToCode(response.status), message });
  }
  if (response.status === 204 || schema === null) return undefined as S["Encoded"];
  const json: unknown = await response.json();
  // Validate against the JSON wire codec — the SAME derivation the API
  // serializes with (HttpApiEndpoint runs success schemas through
  // Schema.toCodecJson, which is how Dates and bigints travel as strings).
  // Decoding the raw domain schema instead would reject its own wire.
  Schema.decodeUnknownSync(Schema.toCodecJson(schema))(json);
  return json as S["Encoded"];
};

/** Forward one request to the API; surface its own message on failure. */
const call = async <S extends Schema.Top & Schema.ConstraintDecoder<unknown>>(
  ctx: TrpcContext,
  path: string,
  schema: S | null,
  options: CallOptions = {},
): Promise<S["Encoded"]> => {
  const response = await apiFetch(ctx, path, options);
  return readResponse(response, path, schema, options);
};

/** Like `call`, but a 404 is `null` — "no such thing yet" is a state, not an error. */
const callOrNull = async <S extends Schema.Top & Schema.ConstraintDecoder<unknown>>(
  ctx: TrpcContext,
  path: string,
  schema: S,
  options: CallOptions = {},
): Promise<S["Encoded"] | null> => {
  const response = await apiFetch(ctx, path, options);
  if (response.status === 404) return null;
  return readResponse(response, path, schema, options);
};

const id = Schema.String;
const array = Schema.Array;
/** Every interpolated path segment goes through this — ids are caller input. */
const seg = encodeURIComponent;

// ─── Queue-era surface (issues · briefs · runs) ─────────────────────────────
const queueRouter = t.router({
  listIssues: t.procedure.query(({ ctx }) => call(ctx, "/api/issues", array(Issue))),
  issueDetail: t.procedure
    .input(input(Schema.Struct({ id })))
    .query(({ ctx, input: i }) => call(ctx, `/api/issues/${seg(i.id)}`, IssueDetail)),
  createIssue: t.procedure
    .input(
      input(
        Schema.Struct({ repository: Schema.String, title: Schema.String, body: Schema.String }),
      ),
    )
    .mutation(({ ctx, input: i }) =>
      call(ctx, "/api/issues", Issue, {
        method: "POST",
        body: { source: "manual", externalRef: null, ...i },
      }),
    ),
  moveIssue: t.procedure
    .input(
      input(
        Schema.Struct({
          id,
          stage: Schema.Literals(["triage", "queued"]),
          position: Schema.NullOr(Schema.Number),
        }),
      ),
    )
    .mutation(({ ctx, input: i }) =>
      call(ctx, `/api/issues/${seg(i.id)}/move`, Issue, {
        method: "POST",
        body: { stage: i.stage, position: i.position },
      }),
    ),
  runDetail: t.procedure
    .input(input(Schema.Struct({ id })))
    .query(({ ctx, input: i }) => call(ctx, `/api/runs/${seg(i.id)}`, RunDetail)),
  runTrace: t.procedure
    .input(input(Schema.Struct({ id, from: Schema.optional(Schema.String) })))
    .query(({ ctx, input: i }) =>
      call(
        ctx,
        `/api/runs/${seg(i.id)}/trace${i.from === undefined ? "" : `?from=${seg(i.from)}`}`,
        TracePage,
      ),
    ),
  runSources: t.procedure
    .input(input(Schema.Struct({ id })))
    .query(({ ctx, input: i }) =>
      call(ctx, `/api/runs/${seg(i.id)}/sources`, array(RunSourceView)),
    ),
  briefByIssue: t.procedure
    .input(input(Schema.Struct({ issueId: id })))
    .query(({ ctx, input: i }) =>
      callOrNull(ctx, `/api/issues/${seg(i.issueId)}/brief`, BriefDetail),
    ),
  listBriefComments: t.procedure
    .input(input(Schema.Struct({ issueId: id })))
    .query(({ ctx, input: i }) =>
      call(ctx, `/api/issues/${seg(i.issueId)}/brief/comments`, array(BriefComment)),
    ),
  postBriefComment: t.procedure
    .input(input(Schema.Struct({ issueId: id, thread: Schema.String, body: Schema.String })))
    .mutation(({ ctx, input: i }) =>
      call(ctx, `/api/issues/${seg(i.issueId)}/brief/comments`, BriefComment, {
        method: "POST",
        body: { thread: i.thread, body: i.body },
      }),
    ),
  briefVersions: t.procedure
    .input(input(Schema.Struct({ issueId: id })))
    .query(({ ctx, input: i }) =>
      call(ctx, `/api/issues/${seg(i.issueId)}/brief/versions`, array(BriefVersion)),
    ),
});

// ─── Platform · identity · machine ──────────────────────────────────────────
const platformRouter = t.router({
  health: t.procedure.query(({ ctx }) => call(ctx, "/api/health", HealthStatus)),
  machine: t.procedure.query(({ ctx }) => call(ctx, "/api/machine", MachineView)),
  sealantConnection: t.procedure.query(({ ctx }) =>
    call(ctx, "/api/sealant/connection", SealantConnection),
  ),
  sealantIdentity: t.procedure.query(({ ctx }) => call(ctx, "/api/me/sealant", SealantIdentity)),
  connectAccount: t.procedure
    .input(
      input(
        Schema.Struct({
          provider: Schema.Literals(["claude", "codex", "github"]),
          secret: Schema.String,
        }),
      ),
    )
    .mutation(({ ctx, input: i }) =>
      call(ctx, "/api/me/sealant/accounts", ConnectedAccount, { method: "POST", body: i }),
    ),
  disconnectAccount: t.procedure
    .input(input(Schema.Struct({ id })))
    .mutation(({ ctx, input: i }) =>
      call(ctx, `/api/me/sealant/accounts/${seg(i.id)}`, ConnectedAccount, { method: "DELETE" }),
    ),
});

// ─── Projects · references · mounts · recipes ───────────────────────────────
const projectsRouter = t.router({
  list: t.procedure.query(({ ctx }) => call(ctx, "/api/projects", array(Project))),
  detail: t.procedure
    .input(input(Schema.Struct({ id })))
    .query(({ ctx, input: i }) => call(ctx, `/api/projects/${seg(i.id)}`, ProjectDetail)),
  adopt: t.procedure
    .input(
      input(
        Schema.Struct({
          name: Schema.String,
          source: Schema.String,
          gitAuthMode: Schema.optional(GitAuthMode),
        }),
      ),
    )
    .mutation(({ ctx, input: i }) =>
      call(ctx, "/api/projects", Project, { method: "POST", body: i }),
    ),
  remove: t.procedure
    .input(input(Schema.Struct({ id })))
    .mutation(({ ctx, input: i }) =>
      call(ctx, `/api/projects/${seg(i.id)}`, RemovalReport, { method: "DELETE" }),
    ),
  setAutomation: t.procedure
    .input(
      input(
        Schema.Struct({
          projectId: id,
          autoTour: AutomationChoice,
          autoSuggest: AutomationChoice,
          autoName: AutomationChoice,
        }),
      ),
    )
    .mutation(({ ctx, input: { projectId, ...choices } }) =>
      call(ctx, `/api/projects/${seg(projectId)}/automation`, Project, {
        method: "PUT",
        body: choices,
      }),
    ),
  setWorkspaceImage: t.procedure
    .input(input(Schema.Struct({ projectId: id, workspaceImage: Schema.NullOr(WorkspaceImage) })))
    .mutation(({ ctx, input: i }) =>
      call(
        ctx,
        `/api/projects/${seg(i.projectId)}/workspace-image`,
        ProjectWorkspaceImageSaveResult,
        {
          method: "PUT",
          body: { workspaceImage: i.workspaceImage },
        },
      ),
    ),
  setApplyDotfiles: t.procedure
    .input(input(Schema.Struct({ projectId: id, applyDotfiles: Schema.Boolean })))
    .mutation(({ ctx, input: i }) =>
      call(ctx, `/api/projects/${seg(i.projectId)}/apply-dotfiles`, Project, {
        method: "PUT",
        body: { applyDotfiles: i.applyDotfiles },
      }),
    ),
  setGitAuth: t.procedure
    .input(input(Schema.Struct({ projectId: id, gitAuthMode: GitAuthMode })))
    .mutation(({ ctx, input: i }) =>
      call(ctx, `/api/projects/${seg(i.projectId)}/git-auth`, Project, {
        method: "PUT",
        body: { gitAuthMode: i.gitAuthMode },
      }),
    ),
  setHotSessions: t.procedure
    .input(input(Schema.Struct({ projectId: id, hotSessions: Schema.Number })))
    .mutation(({ ctx, input: i }) =>
      call(ctx, `/api/projects/${seg(i.projectId)}/hot-sessions`, Project, {
        method: "PUT",
        body: { hotSessions: i.hotSessions },
      }),
    ),
  hotSessionsStatus: t.procedure
    .input(input(Schema.Struct({ projectId: id })))
    .query(({ ctx, input: i }) =>
      call(ctx, `/api/projects/${seg(i.projectId)}/hot-sessions`, ProjectHotSessionsStatus),
    ),
  references: t.procedure
    .input(input(Schema.Struct({ projectId: id })))
    .query(({ ctx, input: i }) =>
      call(ctx, `/api/projects/${seg(i.projectId)}/references`, array(Reference)),
    ),
  selectReferences: t.procedure
    .input(input(Schema.Struct({ projectId: id, referenceIds: array(Schema.String) })))
    .mutation(({ ctx, input: i }) =>
      call(ctx, `/api/projects/${seg(i.projectId)}/references`, array(Reference), {
        method: "PUT",
        body: { referenceIds: i.referenceIds },
      }),
    ),
  mounts: t.procedure
    .input(input(Schema.Struct({ projectId: id })))
    .query(({ ctx, input: i }) =>
      call(ctx, `/api/projects/${seg(i.projectId)}/mounts`, array(ProjectMount)),
    ),
  addMount: t.procedure
    .input(
      input(
        Schema.Struct({
          projectId: id,
          name: Schema.String,
          hostPath: Schema.String,
          readOnly: Schema.Boolean,
        }),
      ),
    )
    .mutation(({ ctx, input: { projectId, ...body } }) =>
      call(ctx, `/api/projects/${seg(projectId)}/mounts`, ProjectMount, { method: "POST", body }),
    ),
  removeMount: t.procedure
    .input(input(Schema.Struct({ projectId: id, mountId: id })))
    .mutation(({ ctx, input: i }) =>
      call(ctx, `/api/projects/${seg(i.projectId)}/mounts/${seg(i.mountId)}`, null, {
        method: "DELETE",
      }),
    ),
  recipes: t.procedure
    .input(input(Schema.Struct({ projectId: id })))
    .query(({ ctx, input: i }) =>
      call(ctx, `/api/projects/${seg(i.projectId)}/service-recipes`, array(ServiceRecipe)),
    ),
  addRecipe: t.procedure
    .input(
      input(
        Schema.Struct({
          projectId: id,
          name: Schema.String,
          command: Schema.NullOr(Schema.String),
          port: Schema.Number,
          protocol: Schema.Literals(["tcp", "udp"]),
          browserScheme: Schema.NullOr(Schema.Literals(["http", "https"])),
        }),
      ),
    )
    .mutation(({ ctx, input: { projectId, ...body } }) =>
      call(ctx, `/api/projects/${seg(projectId)}/service-recipes`, ServiceRecipe, {
        method: "POST",
        body,
      }),
    ),
  removeRecipe: t.procedure
    .input(input(Schema.Struct({ projectId: id, name: Schema.String })))
    .mutation(({ ctx, input: i }) =>
      call(
        ctx,
        `/api/projects/${seg(i.projectId)}/service-recipes/${encodeURIComponent(i.name)}`,
        null,
        {
          method: "DELETE",
        },
      ),
    ),
});

// ─── References (global) · git keys · bridge ────────────────────────────────
const gitRouter = t.router({
  references: t.procedure.query(({ ctx }) => call(ctx, "/api/references", array(Reference))),
  addReference: t.procedure
    .input(
      input(
        Schema.Struct({
          name: Schema.String,
          source: Schema.String,
          ref: Schema.NullOr(Schema.String),
        }),
      ),
    )
    .mutation(({ ctx, input: i }) =>
      call(ctx, "/api/references", Reference, { method: "POST", body: i }),
    ),
  removeReference: t.procedure
    .input(input(Schema.Struct({ id })))
    .mutation(({ ctx, input: i }) =>
      call(ctx, `/api/references/${seg(i.id)}`, null, { method: "DELETE" }),
    ),
  refreshReference: t.procedure
    .input(input(Schema.Struct({ id })))
    .mutation(({ ctx, input: i }) =>
      call(ctx, `/api/references/${seg(i.id)}/refresh`, Reference, { method: "POST", body: {} }),
    ),
  key: t.procedure.query(({ ctx }) => call(ctx, "/api/keys/git", GitKeyView)),
  initKey: t.procedure.mutation(({ ctx }) =>
    call(ctx, "/api/keys/git", GitKeyView, { method: "POST" }),
  ),
  bridgeStatus: t.procedure.query(({ ctx }) => call(ctx, "/api/keys/bridge", GitBridgeStatusView)),
});

// ─── Sessions · processes · services ────────────────────────────────────────
const sessionsRouter = t.router({
  listActive: t.procedure.query(({ ctx }) => call(ctx, "/api/sessions", array(Session))),
  detail: t.procedure
    .input(input(Schema.Struct({ id })))
    .query(({ ctx, input: i }) => call(ctx, `/api/sessions/${seg(i.id)}`, SessionDetail)),
  create: t.procedure
    .input(
      input(
        Schema.Struct({
          projectId: id,
          harness: Schema.String,
          base: Schema.NullOr(Schema.String),
        }),
      ),
    )
    .mutation(({ ctx, input: i }) =>
      call(ctx, `/api/projects/${seg(i.projectId)}/sessions`, Session, {
        method: "POST",
        body: { harness: i.harness, label: null, base: i.base },
      }),
    ),
  launch: t.procedure
    .input(input(Schema.Struct({ id, body: LaunchRequest })))
    .mutation(({ ctx, input: i }) =>
      call(ctx, `/api/sessions/${seg(i.id)}/launch`, Session, { method: "POST", body: i.body }),
    ),
  stop: t.procedure
    .input(input(Schema.Struct({ id })))
    .mutation(({ ctx, input: i }) =>
      call(ctx, `/api/sessions/${seg(i.id)}/stop`, Session, { method: "POST", body: {} }),
    ),
  resume: t.procedure
    .input(input(Schema.Struct({ id, harness: Schema.NullOr(Schema.String) })))
    .mutation(({ ctx, input: i }) =>
      call(ctx, `/api/sessions/${seg(i.id)}/resume`, Session, {
        method: "POST",
        body: { harness: i.harness },
      }),
    ),
  remove: t.procedure
    .input(input(Schema.Struct({ id })))
    .mutation(({ ctx, input: i }) =>
      call(ctx, `/api/sessions/${seg(i.id)}`, RemovalReport, { method: "DELETE" }),
    ),
  setLabel: t.procedure
    .input(input(Schema.Struct({ id, label: Schema.NullOr(Schema.String) })))
    .mutation(({ ctx, input: i }) =>
      call(ctx, `/api/sessions/${seg(i.id)}/label`, Session, {
        method: "POST",
        body: { label: i.label },
      }),
    ),
  checkpoint: t.procedure
    .input(input(Schema.Struct({ id, trigger: Schema.Literals(["review-open", "user-mark"]) })))
    .mutation(({ ctx, input: i }) =>
      call(ctx, `/api/sessions/${seg(i.id)}/checkpoints`, Checkpoint, {
        method: "POST",
        body: { trigger: i.trigger },
      }),
    ),
  transcript: t.procedure
    .input(input(Schema.Struct({ id })))
    .query(({ ctx, input: i }) =>
      call(ctx, `/api/sessions/${seg(i.id)}/transcript`, SessionTranscript),
    ),
  processes: t.procedure
    .input(input(Schema.Struct({ id })))
    .query(({ ctx, input: i }) =>
      call(ctx, `/api/sessions/${seg(i.id)}/processes`, array(SessionProcess)),
    ),
  recipes: t.procedure
    .input(input(Schema.Struct({ id })))
    .query(({ ctx, input: i }) =>
      call(ctx, `/api/sessions/${seg(i.id)}/recipes`, array(ServiceRecipe)),
    ),
  pendingFollowUp: t.procedure.input(input(Schema.Struct({ id }))).query(({ ctx, input: i }) =>
    // The contract's success is NullOr(FollowUp): 200 with a null body is
    // the ordinary "no follow-up pending" answer, not an error.
    call(ctx, `/api/sessions/${seg(i.id)}/follow-up`, Schema.NullOr(FollowUp)),
  ),
  deliverFollowUp: t.procedure
    .input(input(Schema.Struct({ id, request: DeliverFollowUpRequest })))
    .mutation(({ ctx, input: i }) =>
      call(ctx, `/api/sessions/${seg(i.id)}/follow-up/deliver`, FollowUp, {
        method: "POST",
        body: i.request,
      }),
    ),
  runServiceRecipe: t.procedure
    .input(input(Schema.Struct({ sessionId: id, name: Schema.String })))
    .mutation(({ ctx, input: i }) =>
      call(ctx, `/api/sessions/${seg(i.sessionId)}/services/recipe`, ServiceView, {
        method: "POST",
        body: { name: i.name },
      }),
    ),
  runService: t.procedure
    .input(
      input(
        Schema.Struct({
          sessionId: id,
          argv: array(Schema.String),
          port: Schema.Number,
          name: Schema.NullOr(Schema.String),
          protocol: Schema.optional(Schema.Literals(["tcp", "udp"])),
          browserScheme: Schema.optional(Schema.NullOr(Schema.Literals(["http", "https"]))),
        }),
      ),
    )
    .mutation(({ ctx, input: { sessionId, ...body } }) =>
      call(ctx, `/api/sessions/${seg(sessionId)}/services/run`, ServiceView, {
        method: "POST",
        body,
      }),
    ),
  addService: t.procedure
    .input(
      input(
        Schema.Struct({
          sessionId: id,
          port: Schema.Number,
          name: Schema.NullOr(Schema.String),
          protocol: Schema.optional(Schema.Literals(["tcp", "udp"])),
          browserScheme: Schema.optional(Schema.NullOr(Schema.Literals(["http", "https"]))),
        }),
      ),
    )
    .mutation(({ ctx, input: { sessionId, ...body } }) =>
      call(ctx, `/api/sessions/${seg(sessionId)}/services`, ServiceView, { method: "POST", body }),
    ),
});

const servicesRouter = t.router({
  list: t.procedure
    .input(input(Schema.Struct({ all: Schema.optional(Schema.Boolean) })))
    .query(({ ctx, input: i }) =>
      call(ctx, `/api/services${i.all === true ? "?all=1" : ""}`, array(ServiceView)),
    ),
  restart: t.procedure
    .input(input(Schema.Struct({ id })))
    .mutation(({ ctx, input: i }) =>
      call(ctx, `/api/services/${seg(i.id)}/restart`, ServiceView, { method: "POST", body: {} }),
    ),
  stop: t.procedure
    .input(input(Schema.Struct({ id })))
    .mutation(({ ctx, input: i }) =>
      call(ctx, `/api/services/${seg(i.id)}/stop`, ServiceView, { method: "POST", body: {} }),
    ),
});

// ─── Changes · review ───────────────────────────────────────────────────────
const changesRouter = t.router({
  stats: t.procedure
    .input(input(Schema.Struct({ id })))
    .query(({ ctx, input: i }) => call(ctx, `/api/changes/${seg(i.id)}/stats`, ChangeStats)),
  diff: t.procedure
    .input(input(Schema.Struct({ id })))
    .query(({ ctx, input: i }) => call(ctx, `/api/changes/${seg(i.id)}/diff`, ChangeDiff)),
  openReview: t.procedure
    .input(input(Schema.Struct({ id, idempotencyKey: Schema.String })))
    .mutation(({ ctx, input: i }) =>
      call(ctx, `/api/changes/${seg(i.id)}/reviews/open`, OpenReviewResult, {
        method: "POST",
        body: { idempotencyKey: i.idempotencyKey },
      }),
    ),
  reviewDiff: t.procedure
    .input(input(Schema.Struct({ id, sliceId: id })))
    .query(({ ctx, input: i }) =>
      call(ctx, `/api/changes/${seg(i.id)}/reviews/${seg(i.sliceId)}/diff`, ReviewDiffView),
    ),
  comments: t.procedure
    .input(input(Schema.Struct({ id })))
    .query(({ ctx, input: i }) =>
      call(ctx, `/api/changes/${seg(i.id)}/comments`, array(ReviewComment)),
    ),
  postSliceComment: t.procedure
    .input(
      input(
        Schema.Struct({
          changeId: id,
          sliceId: id,
          target: SliceCommentTargetRequest,
          body: Schema.String,
        }),
      ),
    )
    .mutation(({ ctx, input: i }) =>
      call(
        ctx,
        `/api/changes/${seg(i.changeId)}/reviews/${seg(i.sliceId)}/comments`,
        ReviewComment,
        {
          method: "POST",
          body: { target: i.target, body: i.body },
        },
      ),
    ),
  setCommentState: t.procedure
    .input(
      input(
        Schema.Struct({
          changeId: id,
          commentId: id,
          state: Schema.Literals(["open", "addressed", "dismissed"]),
        }),
      ),
    )
    .mutation(({ ctx, input: i }) =>
      call(
        ctx,
        `/api/changes/${seg(i.changeId)}/comments/${seg(i.commentId)}/state`,
        ReviewComment,
        {
          method: "POST",
          body: { state: i.state },
        },
      ),
    ),
  tour: t.procedure.input(input(Schema.Struct({ id }))).query(({ ctx, input: i }) =>
    // Success is NullOr(ChangeTour): 200-null means "no tour yet".
    call(ctx, `/api/changes/${seg(i.id)}/tour`, Schema.NullOr(ChangeTour)),
  ),
  passes: t.procedure
    .input(input(Schema.Struct({ id })))
    .query(({ ctx, input: i }) => call(ctx, `/api/changes/${seg(i.id)}/passes`, array(ChangePass))),
  queueRead: t.procedure.input(input(Schema.Struct({ id }))).mutation(({ ctx, input: i }) =>
    call(ctx, `/api/changes/${seg(i.id)}/read`, Schema.Struct({ queued: Schema.Boolean }), {
      method: "POST",
      body: {},
    }),
  ),
  queueTour: t.procedure.input(input(Schema.Struct({ id }))).mutation(({ ctx, input: i }) =>
    call(ctx, `/api/changes/${seg(i.id)}/tour`, Schema.Struct({ queued: Schema.Boolean }), {
      method: "POST",
      body: {},
    }),
  ),
  queueSuggest: t.procedure.input(input(Schema.Struct({ id }))).mutation(({ ctx, input: i }) =>
    call(ctx, `/api/changes/${seg(i.id)}/suggest`, Schema.Struct({ queued: Schema.Boolean }), {
      method: "POST",
      body: {},
    }),
  ),
});

// ─── Settings · dotfiles · devices ──────────────────────────────────────────
const settingsRouter = t.router({
  get: t.procedure.query(({ ctx }) => call(ctx, "/api/settings", MendSettings)),
  put: t.procedure
    .input(input(MendSettings))
    .mutation(({ ctx, input: i }) =>
      call(ctx, "/api/settings", MendSettings, { method: "PUT", body: i }),
    ),
  saveWorkspaceEnvironment: t.procedure.input(input(WorkspaceImage)).mutation(({ ctx, input: i }) =>
    call(ctx, "/api/settings/workspace-environment", WorkspaceEnvironmentSaveResult, {
      method: "PUT",
      body: i,
    }),
  ),
  environmentSuggestions: t.procedure.query(({ ctx }) =>
    call(ctx, "/api/settings/environment-suggestions", HostEnvironmentSuggestionsView),
  ),
  dotfiles: t.procedure.query(({ ctx }) => call(ctx, "/api/dotfiles", DotfilesView)),
  putDotfilesRepository: t.procedure
    .input(input(DotfilesRepositoryRequest))
    .mutation(({ ctx, input: i }) =>
      call(ctx, "/api/dotfiles/repository", DotfilesView, { method: "PUT", body: i }),
    ),
  postDotfilesSnapshot: t.procedure
    .input(input(DotfilesSnapshotRequest))
    .mutation(({ ctx, input: i }) =>
      call(ctx, "/api/dotfiles/snapshot", DotfilesView, { method: "POST", body: i }),
    ),
  deleteDotfilesSnapshot: t.procedure.mutation(({ ctx }) =>
    call(ctx, "/api/dotfiles/snapshot", DotfilesView, { method: "DELETE" }),
  ),
});

const devicesRouter = t.router({
  list: t.procedure.query(({ ctx }) => call(ctx, "/api/me/devices", array(DeviceView))),
  createPairing: t.procedure.mutation(({ ctx }) =>
    call(ctx, "/api/me/devices/pairings", PairingView, { method: "POST" }),
  ),
  revoke: t.procedure.input(input(Schema.Struct({ id }))).mutation(({ ctx, input: i }) =>
    call(ctx, `/api/me/devices/${encodeURIComponent(i.id)}`, DeviceView, {
      method: "DELETE",
    }),
  ),
});

// ─── Project environment · secrets (structured write results) ───────────────
// 422/409 are OUTCOMES here, not transport errors: the UI keeps drafts on a
// stale write and shows per-field issues on a rejection, so the procedures
// return a discriminated union instead of throwing — same contract classes,
// decoded server-side.

type EnvironmentWriteFailure =
  | {
      readonly ok: false;
      readonly kind: "rejected";
      readonly issues: typeof EnvironmentRejected.Encoded.issues;
    }
  | { readonly ok: false; readonly kind: "stale"; readonly currentRevision: number }
  | { readonly ok: false; readonly kind: "http"; readonly status: number };

const decodeRejected = Schema.decodeUnknownSync(Schema.toCodecJson(EnvironmentRejected));
const decodeStale = Schema.decodeUnknownSync(Schema.toCodecJson(EnvironmentStaleWrite));

const envWrite = async <S extends Schema.Top & Schema.ConstraintDecoder<unknown>>(
  ctx: TrpcContext,
  path: string,
  resultSchema: S,
  options: CallOptions,
): Promise<{ readonly ok: true; readonly result: S["Encoded"] } | EnvironmentWriteFailure> => {
  const response = await apiFetch(ctx, path, options);
  if (response.status === 401) throw new TRPCError({ code: "UNAUTHORIZED" });
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) {
    Schema.decodeUnknownSync(Schema.toCodecJson(resultSchema))(body);
    return { ok: true, result: body as S["Encoded"] };
  }
  if (response.status === 422) {
    try {
      return { ok: false, kind: "rejected", issues: decodeRejected(body).issues };
    } catch {
      return { ok: false, kind: "http", status: response.status };
    }
  }
  if (response.status === 409) {
    try {
      return { ok: false, kind: "stale", currentRevision: decodeStale(body).currentRevision };
    } catch {
      return { ok: false, kind: "http", status: response.status };
    }
  }
  return { ok: false, kind: "http", status: response.status };
};

const environmentRouter = t.router({
  environment: t.procedure
    .input(input(Schema.Struct({ projectId: id })))
    .query(({ ctx, input: i }) =>
      call(ctx, `/api/projects/${seg(i.projectId)}/environment`, ProjectEnvironmentSnapshot),
    ),
  createVariable: t.procedure
    .input(input(Schema.Struct({ projectId: id, name: Schema.String, value: Schema.String })))
    .mutation(({ ctx, input: { projectId, ...body } }) =>
      envWrite(
        ctx,
        `/api/projects/${seg(projectId)}/environment/variables`,
        ProjectEnvironmentMutationResult,
        {
          method: "POST",
          body,
        },
      ),
    ),
  updateVariable: t.procedure
    .input(
      input(
        Schema.Struct({
          projectId: id,
          variableId: id,
          name: Schema.String,
          value: Schema.String,
          expectedRevision: Schema.Int,
        }),
      ),
    )
    .mutation(({ ctx, input: { projectId, variableId, ...body } }) =>
      envWrite(
        ctx,
        `/api/projects/${seg(projectId)}/environment/variables/${seg(variableId)}`,
        ProjectEnvironmentMutationResult,
        { method: "PUT", body },
      ),
    ),
  removeVariable: t.procedure
    .input(input(Schema.Struct({ projectId: id, variableId: id, expectedRevision: Schema.Int })))
    .mutation(({ ctx, input: i }) =>
      envWrite(
        ctx,
        `/api/projects/${seg(i.projectId)}/environment/variables/${seg(i.variableId)}`,
        ProjectEnvironmentMutationResult,
        { method: "DELETE", body: { expectedRevision: i.expectedRevision } },
      ),
    ),
  secrets: t.procedure
    .input(input(Schema.Struct({ projectId: id })))
    .query(({ ctx, input: i }) =>
      call(ctx, `/api/projects/${seg(i.projectId)}/secrets`, ProjectSecretsSnapshot),
    ),
  createSecret: t.procedure
    .input(input(Schema.Struct({ projectId: id, name: Schema.String, value: Schema.String })))
    .mutation(({ ctx, input: { projectId, ...body } }) =>
      envWrite(ctx, `/api/projects/${seg(projectId)}/secrets`, ProjectSecretMutationResult, {
        method: "POST",
        body,
      }),
    ),
  updateSecret: t.procedure
    .input(
      input(
        Schema.Struct({
          projectId: id,
          secretId: id,
          name: Schema.String,
          value: Schema.NullOr(Schema.String),
          expectedRevision: Schema.Int,
        }),
      ),
    )
    .mutation(({ ctx, input: { projectId, secretId, ...body } }) =>
      envWrite(
        ctx,
        `/api/projects/${seg(projectId)}/secrets/${seg(secretId)}`,
        ProjectSecretMutationResult,
        {
          method: "PUT",
          body,
        },
      ),
    ),
  removeSecret: t.procedure
    .input(input(Schema.Struct({ projectId: id, secretId: id, expectedRevision: Schema.Int })))
    .mutation(({ ctx, input: i }) =>
      envWrite(
        ctx,
        `/api/projects/${seg(i.projectId)}/secrets/${seg(i.secretId)}`,
        ProjectSecretMutationResult,
        {
          method: "DELETE",
          body: { expectedRevision: i.expectedRevision },
        },
      ),
    ),
  load: t.procedure
    .input(
      input(
        Schema.Struct({
          projectId: id,
          contents: Schema.String,
          allSecret: Schema.Boolean,
          secretNames: Schema.Array(Schema.String),
        }),
      ),
    )
    .mutation(({ ctx, input: { projectId, ...body } }) =>
      call(ctx, `/api/projects/${seg(projectId)}/environment/load`, EnvironmentLoadReport, {
        method: "POST",
        body,
      }),
    ),
});

export const appRouter = t.router({
  environment: environmentRouter,
  queue: queueRouter,
  platform: platformRouter,
  projects: projectsRouter,
  git: gitRouter,
  sessions: sessionsRouter,
  services: servicesRouter,
  changes: changesRouter,
  settings: settingsRouter,
  devices: devicesRouter,
});

export type AppRouter = typeof appRouter;

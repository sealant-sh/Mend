import type { DotfilesRepositoryRequest } from "@mend/api-contracts";
import type { WorkspaceImage } from "@mend/domain";
import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "../server/router.ts";
import { orLogin, trpc } from "./trpc.ts";

/**
 * The UI's data facade. Every type is the wire (Encoded) side of the real
 * contract — @mend/api-contracts and @mend/domain, the same schemas the API
 * encodes with — and every call rides the web tier's tRPC surface, which
 * forwards to the API and validates responses against those schemas. Nothing
 * here is hand-rolled; a wire change shows up as a compile error in this
 * file, not a runtime surprise in a view.
 */

// ─── Wire types: exactly what the tRPC client delivers ──────────────────────
// inferRouterOutputs applies tRPC's serialization to the router's contract-
// validated outputs, so these are the true client-side shapes — brands and
// Dates flattened to the JSON the browser actually holds. The router's
// procedures decode every response against @mend/api-contracts, so a wire
// change breaks THERE (loudly), and these types follow automatically.

type Outputs = inferRouterOutputs<AppRouter>;

export type IssueDto = Outputs["queue"]["listIssues"][number];
export type IssueStage = IssueDto["stage"];
export type IssueDetailDto = Outputs["queue"]["issueDetail"];
export type RunDto = IssueDetailDto["runs"][number];
export type RunStatus = RunDto["status"];
export type FailureBriefDto = NonNullable<RunDto["failureBrief"]>;
export type EvidencePointerDto = FailureBriefDto["evidence"][number];
export type RunDetailDto = Outputs["queue"]["runDetail"];
export type RunCommandDto = RunDetailDto["commands"][number];
export type LossReportDto = NonNullable<RunDetailDto["loss"]>;
export type TracePageDto = Outputs["queue"]["runTrace"];
export type TraceEntryDto = TracePageDto["entries"][number];
export type RunSourceDto = Outputs["queue"]["runSources"][number];

export type BriefDetailDto = NonNullable<Outputs["queue"]["briefByIssue"]>;
export type BriefDto = BriefDetailDto["brief"];
export type ChangeDto = BriefDetailDto["change"];
export type BriefDocumentDto = BriefDto["document"];
export type BriefQuestionDto = BriefDocumentDto["questions"][number];
export type BriefCalloutDto = BriefDocumentDto["attention"][number];
export type BriefEvidenceSourceDto = BriefDocumentDto["evidenceUsed"][number];
export type DispositionDto = BriefQuestionDto["disposition"];
export type BriefCommentDto = Outputs["queue"]["listBriefComments"][number];
export type RoutedActionDto = NonNullable<BriefCommentDto["routedAction"]>;
export type BriefVersionDto = Outputs["queue"]["briefVersions"][number];

export type SealantConnectionDto = Outputs["platform"]["sealantConnection"];
export type SealantIdentityDto = Outputs["platform"]["sealantIdentity"];
export type ConnectedAccountDto = SealantIdentityDto["accounts"][number];
export type ConnectedAccountProviderDto = ConnectedAccountDto["provider"];
export type MachineDto = Outputs["platform"]["machine"];

/**
 * The image's decoding defaults make `mode`/`shell`/`services` optional on
 * the Encoded side, but the API always writes them when encoding — required
 * is the true wire shape, and the discriminated union needs it to narrow.
 */
export type WorkspaceImageDto = WorkspaceImage;

export type ProjectDto = Omit<Outputs["projects"]["list"][number], "workspaceImage"> & {
  readonly workspaceImage: WorkspaceImageDto | null;
};
export type AutomationChoiceDto = ProjectDto["autoTour"];
export type GitAuthModeDto = ProjectDto["gitAuthMode"];
export type ProjectDetailDto = Omit<Outputs["projects"]["detail"], "project"> & {
  readonly project: ProjectDto;
};
export type SessionDto = Outputs["sessions"]["listActive"][number];
export type SessionStatusDto = SessionDto["status"];
export type SessionAnnotationDto = ProjectDetailDto["annotations"][number];
export type ChangeStatsDto = Outputs["changes"]["stats"];
export type RemovalReportDto = Outputs["projects"]["remove"];
export type SessionDetailDto = Outputs["sessions"]["detail"];
export type CheckpointDto = SessionDetailDto["checkpoints"][number];
export type SessionChangeDto = NonNullable<SessionDetailDto["change"]>;
export type ChangeDiffDto = Outputs["changes"]["diff"];
export type ChangedFileDto = ChangeDiffDto["files"][number];
export type OpenReviewDto = Outputs["changes"]["openReview"];
export type ReviewSliceDto = OpenReviewDto["slice"];
export type ReviewDiffDto = Outputs["changes"]["reviewDiff"];
export type ReviewDiffFileDto = ReviewDiffDto["files"][number];
export type ReviewDiffHunkDto = ReviewDiffFileDto["hunks"][number];
export type ReviewCommentDto = Outputs["changes"]["comments"][number];
export type ReviewCommentAnchorDto = NonNullable<ReviewCommentDto["anchor"]>;
export type RecordLinkDto = ReviewCommentDto["evidence"][number];
export type ChangeTourDto = NonNullable<Outputs["changes"]["tour"]>;
export type TourStopDto = ChangeTourDto["stops"][number];
export type ChangePassDto = Outputs["changes"]["passes"][number];
export type FollowUpDto = NonNullable<Outputs["sessions"]["pendingFollowUp"]>;

export type SettingsDto = Omit<Outputs["settings"]["get"], "workspaceImage"> & {
  readonly workspaceImage: WorkspaceImageDto;
};
export type WorkspaceEnvironmentSaveResultDto = Omit<
  Outputs["settings"]["saveWorkspaceEnvironment"],
  "settings"
> & { readonly settings: SettingsDto };
export type WorkspacePackageResolutionDto =
  WorkspaceEnvironmentSaveResultDto["resolutions"][number];
export type ProjectWorkspaceImageSaveResultDto = Outputs["projects"]["setWorkspaceImage"];
export type DotfilesDto = Omit<Outputs["settings"]["dotfiles"], "repository"> & {
  readonly repository: DotfilesRepositoryDto | null;
};
export type DotfilesRepositoryDto = NonNullable<DotfilesRepositoryRequest["repository"]>;
export type DotfilesSnapshotDto = NonNullable<DotfilesDto["snapshot"]>;
export type ProjectHotSessionsStatusDto = Outputs["projects"]["hotSessionsStatus"];
export type HostEnvironmentSuggestionsDto = Outputs["settings"]["environmentSuggestions"];

export type GitKeyDto = Outputs["git"]["key"];
export type GitBridgeStatusDto = Outputs["git"]["bridgeStatus"];
export type ReferenceDto = Outputs["git"]["references"][number];
export type ProjectMountDto = Outputs["projects"]["mounts"][number];

export type SessionProcessDto = Outputs["sessions"]["processes"][number];
export type ServiceRecipeDto = Outputs["projects"]["recipes"][number];
export type ServiceViewDto = Outputs["services"]["list"][number];
export type StableServiceDto = ServiceViewDto["service"];
export type ServiceForwardDto = NonNullable<ServiceViewDto["currentForward"]>;
export type ServiceObservationDto = NonNullable<ServiceViewDto["latestObservation"]>;
export type ServiceEndpointDto = ServiceViewDto["endpoints"][number];
export type SessionTranscriptDto = Outputs["sessions"]["transcript"];
export type TranscriptEventDto = SessionTranscriptDto["events"][number];

export type DeviceDto = Outputs["devices"]["list"][number];
export type PairingDto = Outputs["devices"]["createPairing"];

/** The SSE payloads from /api/events — pointers, never data (outside the typed contract). */
export type MendEventDto =
  | { readonly type: "issue"; readonly issueId: string }
  | { readonly type: "run"; readonly runId: string; readonly issueId: string }
  | {
      readonly type: "run-progress";
      readonly runId: string;
      readonly issueId: string;
      readonly sequence: string;
      readonly line: string;
    }
  | { readonly type: "brief"; readonly changeId: string; readonly issueId: string }
  | { readonly type: "brief-comment"; readonly briefId: string; readonly issueId: string };

/** A workbench SSE event — pointers only; clients re-read through the API. */
export interface WorkbenchEventDto {
  readonly type: string;
  readonly projectId?: string;
  readonly sessionId?: string;
  readonly changeId?: string;
  readonly sequence?: string;
  readonly line?: string;
}

// ─── Queue-era surface ──────────────────────────────────────────────────────

export const listIssues = () => orLogin(trpc.queue.listIssues.query());
export const issueDetail = (id: string) => orLogin(trpc.queue.issueDetail.query({ id }));
export const runDetail = (id: string) => orLogin(trpc.queue.runDetail.query({ id }));
export const runTrace = (id: string, from?: string) =>
  orLogin(trpc.queue.runTrace.query({ id, ...(from === undefined ? {} : { from }) }));
export const runSources = (id: string) => orLogin(trpc.queue.runSources.query({ id }));
export const briefByIssue = (issueId: string) =>
  orLogin(trpc.queue.briefByIssue.query({ issueId }));
export const listBriefComments = (issueId: string) =>
  orLogin(trpc.queue.listBriefComments.query({ issueId }));
export const postBriefComment = (issueId: string, thread: string, body: string) =>
  orLogin(trpc.queue.postBriefComment.mutate({ issueId, thread, body }));
export const briefVersions = (issueId: string) =>
  orLogin(trpc.queue.briefVersions.query({ issueId }));
export const createIssue = (input: {
  readonly repository: string;
  readonly title: string;
  readonly body: string;
}) => orLogin(trpc.queue.createIssue.mutate(input));
export const moveIssue = (id: string, stage: "triage" | "queued", position: number | null) =>
  orLogin(trpc.queue.moveIssue.mutate({ id, stage, position }));

// ─── Platform · identity · machine ──────────────────────────────────────────

export const sealantConnection = () => orLogin(trpc.platform.sealantConnection.query());
export const getSealantIdentity = () => orLogin(trpc.platform.sealantIdentity.query());
export const connectAccount = (input: {
  readonly provider: ConnectedAccountProviderDto;
  readonly secret: string;
}) => orLogin(trpc.platform.connectAccount.mutate(input));
export const disconnectAccount = (id: string) =>
  orLogin(trpc.platform.disconnectAccount.mutate({ id }));
export const getMachine = () => orLogin(trpc.platform.machine.query());

// ─── Projects ───────────────────────────────────────────────────────────────

export const listProjects = (): Promise<ReadonlyArray<ProjectDto>> =>
  orLogin(trpc.projects.list.query()) as Promise<ReadonlyArray<ProjectDto>>;
export const projectDetail = (id: string): Promise<ProjectDetailDto> =>
  orLogin(trpc.projects.detail.query({ id })) as Promise<ProjectDetailDto>;
export const adoptProject = (
  name: string,
  source: string,
  gitAuthMode?: GitAuthModeDto,
): Promise<ProjectDto> =>
  orLogin(
    trpc.projects.adopt.mutate({
      name,
      source,
      ...(gitAuthMode === undefined ? {} : { gitAuthMode }),
    }),
  ) as Promise<ProjectDto>;
export const removeProject = (id: string) => orLogin(trpc.projects.remove.mutate({ id }));
export const setProjectAutomation = (
  projectId: string,
  choices: {
    readonly autoTour: AutomationChoiceDto;
    readonly autoSuggest: AutomationChoiceDto;
    readonly autoName: AutomationChoiceDto;
  },
): Promise<ProjectDto> =>
  orLogin(trpc.projects.setAutomation.mutate({ projectId, ...choices })) as Promise<ProjectDto>;
export const setProjectWorkspaceImage = (
  projectId: string,
  workspaceImage: WorkspaceImageDto | null,
) => orLogin(trpc.projects.setWorkspaceImage.mutate({ projectId, workspaceImage }));
export const setProjectApplyDotfiles = (
  projectId: string,
  applyDotfiles: boolean,
): Promise<ProjectDto> =>
  orLogin(
    trpc.projects.setApplyDotfiles.mutate({ projectId, applyDotfiles }),
  ) as Promise<ProjectDto>;
export const setProjectGitAuth = (
  projectId: string,
  gitAuthMode: GitAuthModeDto,
): Promise<ProjectDto> =>
  orLogin(trpc.projects.setGitAuth.mutate({ projectId, gitAuthMode })) as Promise<ProjectDto>;
export const setProjectHotSessions = (
  projectId: string,
  hotSessions: number,
): Promise<ProjectDto> =>
  orLogin(trpc.projects.setHotSessions.mutate({ projectId, hotSessions })) as Promise<ProjectDto>;
export const projectHotSessionsStatus = (projectId: string) =>
  orLogin(trpc.projects.hotSessionsStatus.query({ projectId }));
export const projectReferences = (projectId: string) =>
  orLogin(trpc.projects.references.query({ projectId }));
export const selectProjectReferences = (projectId: string, referenceIds: ReadonlyArray<string>) =>
  orLogin(trpc.projects.selectReferences.mutate({ projectId, referenceIds }));
export const projectMounts = (projectId: string) =>
  orLogin(trpc.projects.mounts.query({ projectId }));
export const addProjectMount = (
  projectId: string,
  input: { readonly name: string; readonly hostPath: string; readonly readOnly: boolean },
) => orLogin(trpc.projects.addMount.mutate({ projectId, ...input }));
export const removeProjectMount = async (projectId: string, mountId: string): Promise<void> => {
  await orLogin(trpc.projects.removeMount.mutate({ projectId, mountId }));
};
export const projectRecipes = (projectId: string) =>
  orLogin(trpc.projects.recipes.query({ projectId }));
export const addProjectRecipe = (
  projectId: string,
  input: {
    readonly name: string;
    readonly command: string | null;
    readonly port: number;
    readonly protocol: "tcp" | "udp";
    readonly browserScheme: "http" | "https" | null;
  },
) => orLogin(trpc.projects.addRecipe.mutate({ projectId, ...input }));
export const removeProjectRecipe = async (projectId: string, name: string): Promise<void> => {
  await orLogin(trpc.projects.removeRecipe.mutate({ projectId, name }));
};

// ─── References · git keys ──────────────────────────────────────────────────

export const listReferences = () => orLogin(trpc.git.references.query());
export const addReference = (name: string, source: string, ref: string | null) =>
  orLogin(trpc.git.addReference.mutate({ name, source, ref }));
export const removeReference = async (id: string): Promise<void> => {
  await orLogin(trpc.git.removeReference.mutate({ id }));
};
export const refreshReference = (id: string) => orLogin(trpc.git.refreshReference.mutate({ id }));
export const gitKey = () => orLogin(trpc.git.key.query());
export const initGitKey = () => orLogin(trpc.git.initKey.mutate());
export const gitBridgeStatus = () => orLogin(trpc.git.bridgeStatus.query());

// ─── Sessions · processes · services ────────────────────────────────────────

export const listActiveSessions = () => orLogin(trpc.sessions.listActive.query());
export const sessionDetail = (id: string) => orLogin(trpc.sessions.detail.query({ id }));
export const createSession = (projectId: string, harness: string, base: string | null = null) =>
  orLogin(trpc.sessions.create.mutate({ projectId, harness, base }));
export const launchSession = (id: string, argv: ReadonlyArray<string>) =>
  orLogin(trpc.sessions.launch.mutate({ id, body: { argv } }));

/** A composed start — the server turns this into the harness's own argv. */
export interface LaunchStartDto {
  readonly prompt?: string;
  readonly model?: string;
  readonly effort?: string;
  readonly permissionMode?: string;
  readonly speed?: string;
}
export const launchSessionStart = (id: string, start: LaunchStartDto) =>
  orLogin(trpc.sessions.launch.mutate({ id, body: { ...start } }));
export const stopSession = (id: string) => orLogin(trpc.sessions.stop.mutate({ id }));
export const resumeSession = (id: string, harness: string | null) =>
  orLogin(trpc.sessions.resume.mutate({ id, harness }));
export const removeSession = (id: string) => orLogin(trpc.sessions.remove.mutate({ id }));
export const setSessionLabel = (id: string, label: string | null) =>
  orLogin(trpc.sessions.setLabel.mutate({ id, label }));
export const checkpointSession = (id: string, trigger: "review-open" | "user-mark") =>
  orLogin(trpc.sessions.checkpoint.mutate({ id, trigger }));
export const sessionTranscript = (id: string) => orLogin(trpc.sessions.transcript.query({ id }));
export const listSessionProcesses = (id: string) => orLogin(trpc.sessions.processes.query({ id }));
export const listSessionRecipes = (id: string) => orLogin(trpc.sessions.recipes.query({ id }));
export const pendingFollowUp = (sessionId: string) =>
  orLogin(trpc.sessions.pendingFollowUp.query({ id: sessionId }));

export interface DeliverFollowUpInput {
  readonly reviewSliceId: string;
  readonly checkpointAId: string;
  readonly checkpointBId: string;
  readonly diffDigest: string;
  readonly commentIds: ReadonlyArray<string>;
  readonly instruction: string;
  readonly idempotencyKey: string;
}
export const deliverFollowUp = (sessionId: string, input: DeliverFollowUpInput) =>
  orLogin(trpc.sessions.deliverFollowUp.mutate({ id: sessionId, request: input }));

export const runServiceRecipe = (sessionId: string, name: string) =>
  orLogin(trpc.sessions.runServiceRecipe.mutate({ sessionId, name }));
export const runService = (
  sessionId: string,
  input: {
    argv: ReadonlyArray<string>;
    port: number;
    name: string | null;
    protocol?: "tcp" | "udp";
    browserScheme?: "http" | "https" | null;
  },
) => orLogin(trpc.sessions.runService.mutate({ sessionId, ...input }));
export const addService = (
  sessionId: string,
  input: {
    port: number;
    name: string | null;
    protocol?: "tcp" | "udp";
    browserScheme?: "http" | "https" | null;
  },
) => orLogin(trpc.sessions.addService.mutate({ sessionId, ...input }));
export const listServices = (all = false) => orLogin(trpc.services.list.query({ all }));
export const restartService = (id: string) => orLogin(trpc.services.restart.mutate({ id }));
export const stopService = (id: string) => orLogin(trpc.services.stop.mutate({ id }));

// ─── Changes · review ───────────────────────────────────────────────────────

export const changeStats = (id: string) => orLogin(trpc.changes.stats.query({ id }));
export const changeDiff = (id: string) => orLogin(trpc.changes.diff.query({ id }));
export const openReview = (id: string, idempotencyKey: string) =>
  orLogin(trpc.changes.openReview.mutate({ id, idempotencyKey }));
export const reviewDiff = (id: string, sliceId: string) =>
  orLogin(trpc.changes.reviewDiff.query({ id, sliceId }));
export const changeComments = (id: string) => orLogin(trpc.changes.comments.query({ id }));

export interface SliceCommentTargetDto {
  readonly oldPath: string | null;
  readonly newPath: string | null;
  readonly side: "old" | "new" | null;
  readonly startLine: number | null;
  readonly endLine: number | null;
  readonly hunkContextHash: string | null;
}
export const postSliceReviewComment = (
  changeId: string,
  sliceId: string,
  target: SliceCommentTargetDto,
  body: string,
) =>
  orLogin(trpc.changes.postSliceComment.mutate({ changeId, sliceId, target: { ...target }, body }));
export const setCommentState = (
  changeId: string,
  commentId: string,
  state: "open" | "addressed" | "dismissed",
) => orLogin(trpc.changes.setCommentState.mutate({ changeId, commentId, state }));
export const changeTour = (changeId: string) => orLogin(trpc.changes.tour.query({ id: changeId }));
export const changePasses = (changeId: string) =>
  orLogin(trpc.changes.passes.query({ id: changeId }));
export const readChange = (changeId: string) =>
  orLogin(trpc.changes.queueRead.mutate({ id: changeId }));
export const composeTour = (changeId: string) =>
  orLogin(trpc.changes.queueTour.mutate({ id: changeId }));
export const suggestChange = (changeId: string) =>
  orLogin(trpc.changes.queueSuggest.mutate({ id: changeId }));

// ─── Settings · dotfiles · devices ──────────────────────────────────────────

export const getSettings = (): Promise<SettingsDto> =>
  orLogin(trpc.settings.get.query()) as Promise<SettingsDto>;
export const putSettings = (settings: SettingsDto) =>
  orLogin(trpc.settings.put.mutate({ ...settings }));
export const saveWorkspaceEnvironment = (
  workspaceImage: WorkspaceImageDto,
): Promise<WorkspaceEnvironmentSaveResultDto> =>
  orLogin(
    trpc.settings.saveWorkspaceEnvironment.mutate(workspaceImage),
  ) as Promise<WorkspaceEnvironmentSaveResultDto>;
export const scanHostEnvironment = () => orLogin(trpc.settings.environmentSuggestions.query());
export const getDotfiles = (): Promise<DotfilesDto> =>
  orLogin(trpc.settings.dotfiles.query()) as Promise<DotfilesDto>;
export const putDotfilesRepository = (
  repository: DotfilesRepositoryDto | null,
): Promise<DotfilesDto> =>
  orLogin(trpc.settings.putDotfilesRepository.mutate({ repository })) as Promise<DotfilesDto>;
export const postDotfilesSnapshot = (payload: {
  readonly files: ReadonlyArray<{ readonly path: string; readonly contentsBase64: string }>;
  readonly source: string;
  readonly merge: boolean;
}): Promise<DotfilesDto> =>
  orLogin(trpc.settings.postDotfilesSnapshot.mutate(payload)) as Promise<DotfilesDto>;
export const deleteDotfilesSnapshot = (): Promise<DotfilesDto> =>
  orLogin(trpc.settings.deleteDotfilesSnapshot.mutate()) as Promise<DotfilesDto>;

export const listDevices = () => orLogin(trpc.devices.list.query());
export const createPairing = () => orLogin(trpc.devices.createPairing.mutate());
export const revokeDevice = (id: string) => orLogin(trpc.devices.revoke.mutate({ id }));

// ─── Pure helpers (unchanged behavior) ──────────────────────────────────────

/**
 * Whether the session's AGENT is live. Session status is a fold over every process — a session
 * reads `idle` while a shell holds the workspace after its agent ended — so the agent's own row
 * answers when one exists; `starting` is a launch with no row yet.
 */
const LIVE_SESSION_STATUSES: ReadonlySet<SessionStatusDto> = new Set<SessionStatusDto>([
  "starting",
  "running",
  "waiting",
  "idle",
]);

export const agentIsLive = (session: SessionDto, currentAgent: SessionProcessDto | null): boolean =>
  currentAgent === null
    ? LIVE_SESSION_STATUSES.has(session.status)
    : session.status === "starting" ||
      (currentAgent.exitedAt === null &&
        (currentAgent.status === "starting" || currentAgent.status === "running"));

const preferredEndpoint = (view: ServiceViewDto): ServiceEndpointDto | null =>
  view.endpoints.find((endpoint) => endpoint.scope === "private") ?? view.endpoints[0] ?? null;

/** Browser behavior is declared by the Service and resolved by the server. */
export const serviceUrl = (view: ServiceViewDto) =>
  view.endpoints.find((endpoint) => endpoint.browserUrl !== null)?.browserUrl ?? null;

/** What a client would connect to, exactly as the server bound it. */
export const serviceEndpoint = (view: ServiceViewDto) => preferredEndpoint(view)?.authority ?? null;

/**
 * How each harness takes an instruction as its opening prompt — the same
 * table the CLI's `mend continue` uses. Null: no known resume command.
 */
export const continueArgv = (harness: string, instruction: string): ReadonlyArray<string> | null =>
  harness === "codex"
    ? ["codex", instruction]
    : harness === "claude"
      ? ["claude", instruction]
      : harness === "opencode"
        ? ["opencode", "run", instruction]
        : null;

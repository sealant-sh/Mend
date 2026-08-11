import * as fs from "node:fs";

import {
  ChangePassesRepo,
  ChangeToursRepo,
  CheckpointsRepo,
  FollowUpsRepo,
  ProjectMountsRepo,
  ProjectsRepo,
  ReferencesRepo,
  ReviewCommentsRepo,
  SessionChangesRepo,
  SessionProcessesRepo,
  SessionsRepo,
  SettingsRepo,
} from "@mend/db";
import { MendSettings, workspaceImagesEqual } from "@mend/domain";
import { FollowUp } from "@mend/domain/workbench";
import { JobRunner } from "@mend/jobs";
import { SessionEngine } from "@mend/sessions";
import { Store, worktreePathOf } from "@mend/store";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import {
  ChangeDiff,
  ChangedFileView,
  ChangeStats,
  CurrentUser,
  MendApi,
  NotFound,
  ProjectDetail,
  RemovalReport,
  SessionActive,
  SessionAnnotation,
  SessionDetail,
  SessionNotLive,
  SettingsFailure,
  StoreFailure,
  SessionTranscript,
  TranscriptEvent,
} from "./contract.ts";
import { HostEnvironment } from "./host-environment.ts";
import { saveResolvedWorkspaceEnvironment } from "./workspace-environment.ts";

/**
 * The workbench handlers (plan §6): projects, sessions, and the session
 * change. Everything here is host-side — repos, the store, the engine; the
 * platform enters only when a session is launched, which is not an API
 * concern yet (the CLI launches; the API steers and reviews).
 */

/**
 * Directory-, mount-, and shell-safe store names (projects and references
 * both become store directories); the leading [a-z0-9] also keeps the store's
 * `_references/` dir collision-free.
 */
const STORE_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Live session states — removal refuses these; project removal stops them. */
const LIVE_STATES = new Set(["starting", "running", "waiting", "idle"]);

/** One settings document; PUT replaces it (clients edit what GET returned). */
export const SettingsGroupLive = HttpApiBuilder.group(MendApi, "settings", (handlers) =>
  handlers
    .handle("get", () =>
      Effect.gen(function* () {
        const settings = yield* SettingsRepo;
        return yield* settings.get();
      }),
    )
    .handle("scanHostEnvironment", () =>
      Effect.gen(function* () {
        const hostEnvironment = yield* HostEnvironment;
        return yield* hostEnvironment.scan();
      }),
    )
    .handle("set", ({ payload }) =>
      Effect.gen(function* () {
        const settings = yield* SettingsRepo;
        const current = yield* settings.get();
        if (workspaceImagesEqual(current.workspaceImage, payload.workspaceImage)) {
          return yield* settings.modify(
            (latest) => new MendSettings({ ...payload, workspaceImage: latest.workspaceImage }),
          );
        }

        const result = yield* saveResolvedWorkspaceEnvironment(
          payload.workspaceImage,
          (_latest, workspaceImage) => new MendSettings({ ...payload, workspaceImage }),
        );
        if (!result.saved) {
          const rejected = result.resolutions
            .filter((resolution) => resolution.status !== "resolved" || !resolution.supported)
            .map((resolution) =>
              resolution.status === "resolved"
                ? `${resolution.requested} (unsupported)`
                : `${resolution.requested} (${resolution.status})`,
            );
          return yield* new SettingsFailure({
            message: `Workspace packages did not resolve for ${payload.workspaceImage.os}: ${rejected.join(", ")}.`,
          });
        }
        return result.settings;
      }),
    )
    .handle("setWorkspaceEnvironment", ({ payload }) =>
      saveResolvedWorkspaceEnvironment(
        payload,
        (latest, workspaceImage) => new MendSettings({ ...latest, workspaceImage }),
      ),
    ),
);

export const ProjectsGroupLive = HttpApiBuilder.group(MendApi, "projects", (handlers) =>
  handlers
    .handle("list", () =>
      Effect.gen(function* () {
        const projects = yield* ProjectsRepo;
        return yield* projects.list();
      }),
    )
    .handle("adopt", ({ payload }) =>
      Effect.gen(function* () {
        const projects = yield* ProjectsRepo;
        const store = yield* Store;
        if (!STORE_NAME.test(payload.name)) {
          return yield* new StoreFailure({
            message: `"${payload.name}" is not a usable project name (lowercase letters, digits, ".", "_", "-").`,
          });
        }
        const existing = yield* projects.byName(payload.name);
        if (existing !== null) {
          return yield* new StoreFailure({
            message: `"${payload.name}" is already adopted — its store lives at ${existing.storePath}`,
          });
        }
        const adopted = yield* store.adopt(payload.name, payload.source).pipe(
          Effect.mapError(
            (error) =>
              new StoreFailure({
                message: error.cause.stderr === "" ? String(error) : error.cause.stderr,
              }),
          ),
        );
        return yield* projects.create({
          name: payload.name,
          originUrl: payload.source,
          storePath: adopted.storePath,
          defaultBranch: adopted.defaultBranch,
          adoptedSha: adopted.headSha,
        });
      }),
    )
    .handle("detail", ({ params }) =>
      Effect.gen(function* () {
        const projects = yield* ProjectsRepo;
        const sessions = yield* SessionsRepo;
        const changes = yield* SessionChangesRepo;
        const project = yield* projects
          .byId(params.id)
          .pipe(Effect.mapError(() => new NotFound({ id: params.id })));
        const projectSessions = yield* sessions.listForProject(params.id);
        const annotations = yield* changes.annotationsForProject(params.id);
        return new ProjectDetail({
          project,
          sessions: projectSessions,
          annotations: annotations.map((row) => new SessionAnnotation(row)),
        });
      }),
    )
    .handle("remove", ({ params }) =>
      Effect.gen(function* () {
        const projects = yield* ProjectsRepo;
        const sessions = yield* SessionsRepo;
        const engine = yield* SessionEngine;
        const store = yield* Store;
        const project = yield* projects
          .byId(params.id)
          .pipe(Effect.mapError(() => new NotFound({ id: params.id })));
        // Stop everything live first — workspaces die with their sessions.
        const projectSessions = yield* sessions.listForProject(params.id);
        yield* Effect.forEach(
          projectSessions.filter((session) => LIVE_STATES.has(session.status)),
          (session) => engine.stop(session.id).pipe(Effect.ignore),
          { concurrency: 4 },
        );
        const { leftover } = yield* store.removeProjectStore(project.storePath);
        yield* projects.remove(params.id);
        return new RemovalReport({ removed: true, leftover });
      }),
    )
    .handle("automation", ({ params, payload }) =>
      Effect.gen(function* () {
        const projects = yield* ProjectsRepo;
        return yield* projects
          .setAutomation(params.id, {
            autoTour: payload.autoTour,
            autoSuggest: payload.autoSuggest,
          })
          .pipe(Effect.mapError(() => new NotFound({ id: params.id })));
      }),
    ),
);

/** The blueprint's path shape, checked early so the failure names the field, not the launch. */
const isNormalizedAbsolutePath = (value: string): boolean =>
  value.startsWith("/") &&
  value !== "/" &&
  !value.endsWith("/") &&
  !value.includes("//") &&
  value.split("/").every((segment) => segment !== "." && segment !== "..");

export const ProjectMountsGroupLive = HttpApiBuilder.group(MendApi, "projectMounts", (handlers) =>
  handlers
    .handle("list", ({ params }) =>
      Effect.gen(function* () {
        const projects = yield* ProjectsRepo;
        const mounts = yield* ProjectMountsRepo;
        yield* projects
          .byId(params.id)
          .pipe(Effect.mapError(() => new NotFound({ id: params.id })));
        return yield* mounts.listForProject(params.id);
      }),
    )
    .handle("add", ({ params, payload }) =>
      Effect.gen(function* () {
        const projects = yield* ProjectsRepo;
        const mounts = yield* ProjectMountsRepo;
        yield* projects
          .byId(params.id)
          .pipe(Effect.mapError(() => new NotFound({ id: params.id })));
        if (!STORE_NAME.test(payload.name)) {
          return yield* new StoreFailure({
            message: `"${payload.name}" is not a usable mount name (lowercase letters, digits, ".", "_", "-").`,
          });
        }
        if (!isNormalizedAbsolutePath(payload.hostPath)) {
          return yield* new StoreFailure({
            message: `Host path must be absolute and normalized (no "..", no trailing slash): ${payload.hostPath}`,
          });
        }
        const isDirectory = yield* Effect.sync(() => {
          try {
            return fs.statSync(payload.hostPath).isDirectory();
          } catch {
            return false;
          }
        });
        if (!isDirectory) {
          return yield* new StoreFailure({
            message: `Not a directory on this machine: ${payload.hostPath}`,
          });
        }
        const existing = yield* mounts.listForProject(params.id);
        const clash = existing.find(
          (mount) => mount.name === payload.name || mount.hostPath === payload.hostPath,
        );
        if (clash !== undefined) {
          return yield* new StoreFailure({
            message: `Already declared on this project: ${clash.name} (${clash.hostPath})`,
          });
        }
        return yield* mounts.create({
          projectId: params.id,
          name: payload.name,
          hostPath: payload.hostPath,
          readOnly: payload.readOnly,
        });
      }),
    )
    .handle("remove", ({ params }) =>
      Effect.gen(function* () {
        const mounts = yield* ProjectMountsRepo;
        const mount = yield* mounts
          .byId(params.mountId)
          .pipe(Effect.mapError(() => new NotFound({ id: params.mountId })));
        if (mount.projectId !== params.id) {
          return yield* new NotFound({ id: params.mountId });
        }
        yield* mounts.remove(params.mountId);
      }),
    ),
);

export const ReferencesGroupLive = HttpApiBuilder.group(MendApi, "references", (handlers) =>
  handlers
    .handle("list", () =>
      Effect.gen(function* () {
        const references = yield* ReferencesRepo;
        return yield* references.list();
      }),
    )
    .handle("add", ({ payload }) =>
      Effect.gen(function* () {
        const references = yield* ReferencesRepo;
        const store = yield* Store;
        if (!STORE_NAME.test(payload.name)) {
          return yield* new StoreFailure({
            message: `"${payload.name}" is not a usable reference name (lowercase letters, digits, ".", "_", "-").`,
          });
        }
        const existing = yield* references.byName(payload.name);
        if (existing !== null) {
          return yield* new StoreFailure({
            message: `"${payload.name}" already exists — its clone lives at ${existing.path}`,
          });
        }
        const cloned = yield* store.cloneReference(payload.name, payload.source, payload.ref).pipe(
          Effect.mapError(
            (error) =>
              new StoreFailure({
                message: error.cause.stderr === "" ? String(error) : error.cause.stderr,
              }),
          ),
        );
        return yield* references.create({
          name: payload.name,
          originUrl: payload.source,
          path: cloned.path,
          pinnedRef: payload.ref,
          headSha: cloned.headSha,
        });
      }),
    )
    .handle("remove", ({ params }) =>
      Effect.gen(function* () {
        const references = yield* ReferencesRepo;
        const store = yield* Store;
        const reference = yield* references
          .byId(params.id)
          .pipe(Effect.mapError(() => new NotFound({ id: params.id })));
        yield* store.removeReference(reference.path);
        yield* references.remove(params.id);
      }),
    )
    .handle("refresh", ({ params }) =>
      Effect.gen(function* () {
        const references = yield* ReferencesRepo;
        const store = yield* Store;
        const reference = yield* references
          .byId(params.id)
          .pipe(Effect.mapError(() => new NotFound({ id: params.id })));
        const refreshed = yield* store
          .refreshReference(reference.path, reference.pinnedRef)
          .pipe(Effect.mapError((error) => new StoreFailure({ message: error.stderr })));
        yield* references.setHead(params.id, refreshed.headSha);
        return yield* references
          .byId(params.id)
          .pipe(Effect.mapError(() => new NotFound({ id: params.id })));
      }),
    )
    .handle("forProject", ({ params }) =>
      Effect.gen(function* () {
        const projects = yield* ProjectsRepo;
        const references = yield* ReferencesRepo;
        yield* projects
          .byId(params.id)
          .pipe(Effect.mapError(() => new NotFound({ id: params.id })));
        return yield* references.listForProject(params.id);
      }),
    )
    .handle("selectForProject", ({ params, payload }) =>
      Effect.gen(function* () {
        const projects = yield* ProjectsRepo;
        const references = yield* ReferencesRepo;
        yield* projects
          .byId(params.id)
          .pipe(Effect.mapError(() => new NotFound({ id: params.id })));
        yield* references.setForProject(params.id, payload.referenceIds);
        return yield* references.listForProject(params.id);
      }),
    ),
);

export const SessionsGroupLive = HttpApiBuilder.group(MendApi, "sessions", (handlers) =>
  handlers
    .handle("listActive", () =>
      Effect.gen(function* () {
        const sessions = yield* SessionsRepo;
        return yield* sessions.listActive();
      }),
    )
    .handle("create", ({ params, payload }) =>
      Effect.gen(function* () {
        const engine = yield* SessionEngine;
        return yield* engine
          .provision({
            projectId: params.id,
            harness: payload.harness,
            label: payload.label,
            base: payload.base,
          })
          .pipe(
            Effect.catchTag("ProjectNotFoundError", () =>
              Effect.fail(new NotFound({ id: params.id })),
            ),
            Effect.catchTag("GitError", (error) =>
              Effect.fail(new StoreFailure({ message: error.stderr })),
            ),
          );
      }),
    )
    .handle("detail", ({ params }) =>
      Effect.gen(function* () {
        const sessions = yield* SessionsRepo;
        const checkpoints = yield* CheckpointsRepo;
        const changes = yield* SessionChangesRepo;
        const session = yield* sessions
          .byId(params.id)
          .pipe(Effect.mapError(() => new NotFound({ id: params.id })));
        const sessionCheckpoints = yield* checkpoints.listForSession(params.id);
        const change = yield* changes.bySession(params.id);
        return new SessionDetail({ session, checkpoints: sessionCheckpoints, change });
      }),
    )
    .handle("listProcesses", ({ params }) =>
      Effect.gen(function* () {
        const sessions = yield* SessionsRepo;
        const processes = yield* SessionProcessesRepo;
        yield* sessions
          .byId(params.id)
          .pipe(Effect.mapError(() => new NotFound({ id: params.id })));
        return yield* processes.listForSession(params.id);
      }),
    )
    .handle("openShell", ({ params }) =>
      Effect.gen(function* () {
        const engine = yield* SessionEngine;
        return yield* engine.openShell(params.id).pipe(
          Effect.catchTag("SessionNotFoundError", () =>
            Effect.fail(new NotFound({ id: params.id })),
          ),
          Effect.catchTag("SessionNotLiveError", () =>
            Effect.fail(new SessionNotLive({ id: params.id })),
          ),
          Effect.catchTag("SealantPlatformError", (error) =>
            Effect.fail(new StoreFailure({ message: error.message })),
          ),
        );
      }),
    )
    .handle("remove", ({ params }) =>
      Effect.gen(function* () {
        const sessions = yield* SessionsRepo;
        const projects = yield* ProjectsRepo;
        const store = yield* Store;
        const session = yield* sessions
          .byId(params.id)
          .pipe(Effect.mapError(() => new NotFound({ id: params.id })));
        if (LIVE_STATES.has(session.status)) {
          return yield* new SessionActive({ id: params.id });
        }
        const project = yield* projects
          .byId(session.projectId)
          .pipe(Effect.mapError(() => new NotFound({ id: session.projectId })));
        const { leftover } = yield* store.removeWorktreeForce(project.storePath, session.worktree);
        yield* sessions.remove(params.id);
        return new RemovalReport({ removed: true, leftover });
      }),
    )
    .handle("label", ({ params, payload }) =>
      Effect.gen(function* () {
        const sessions = yield* SessionsRepo;
        yield* sessions
          .byId(params.id)
          .pipe(Effect.mapError(() => new NotFound({ id: params.id })));
        const trimmed = payload.label === null ? null : payload.label.trim();
        yield* sessions.setLabel(params.id, trimmed === "" ? null : trimmed);
        return yield* sessions
          .byId(params.id)
          .pipe(Effect.mapError(() => new NotFound({ id: params.id })));
      }),
    )
    .handle("stop", ({ params }) =>
      Effect.gen(function* () {
        const engine = yield* SessionEngine;
        const sessions = yield* SessionsRepo;
        yield* engine.stop(params.id).pipe(Effect.mapError(() => new NotFound({ id: params.id })));
        return yield* sessions
          .byId(params.id)
          .pipe(Effect.mapError(() => new NotFound({ id: params.id })));
      }),
    )
    .handle("checkpoint", ({ params, payload }) =>
      Effect.gen(function* () {
        const engine = yield* SessionEngine;
        return yield* engine.checkpointNow(params.id, payload.trigger).pipe(
          Effect.catchTag("SessionNotFoundError", () =>
            Effect.fail(new NotFound({ id: params.id })),
          ),
          Effect.catchTag("ProjectNotFoundError", () =>
            Effect.fail(new NotFound({ id: params.id })),
          ),
          Effect.catchTag("GitError", (error) =>
            Effect.fail(new StoreFailure({ message: error.stderr })),
          ),
        );
      }),
    )
    .handle("transcript", ({ params }) =>
      Effect.gen(function* () {
        const engine = yield* SessionEngine;
        const result = yield* engine
          .transcript(params.id)
          .pipe(
            Effect.catchTag("SessionNotFoundError", () =>
              Effect.fail(new NotFound({ id: params.id })),
            ),
          );
        return new SessionTranscript({
          sourceHarness: result.sourceHarness,
          events: result.events.map(
            (event) =>
              new TranscriptEvent({
                kind: event.kind,
                text: "text" in event ? event.text : null,
                name: event.kind === "tool" ? event.name : null,
                command: event.kind === "tool" ? event.command : null,
                output: event.kind === "tool" ? event.output : null,
              }),
          ),
        });
      }),
    )
    .handle("resume", ({ params, payload }) =>
      Effect.gen(function* () {
        const engine = yield* SessionEngine;
        return yield* engine.resumeSession(params.id, payload.harness).pipe(
          Effect.catchTag("SessionNotFoundError", () =>
            Effect.fail(new NotFound({ id: params.id })),
          ),
          Effect.catchTag("ProjectNotFoundError", () =>
            Effect.fail(new NotFound({ id: params.id })),
          ),
          Effect.catchTag("SealantPlatformError", (error) =>
            Effect.fail(new StoreFailure({ message: error.message })),
          ),
          Effect.catchTags({
            HarnessStateNotFoundError: (error) =>
              Effect.fail(new StoreFailure({ message: error.message })),
            HarnessStateIOError: (error) =>
              Effect.fail(new StoreFailure({ message: error.message })),
            HarnessStateInvalidError: (error) =>
              Effect.fail(new StoreFailure({ message: error.message })),
            HarnessStateCommandError: (error) =>
              Effect.fail(new StoreFailure({ message: error.message })),
          }),
        );
      }),
    )
    .handle("launch", ({ params, payload }) =>
      Effect.gen(function* () {
        const engine = yield* SessionEngine;
        return yield* engine.launch(params.id, payload.argv).pipe(
          Effect.catchTag("SessionNotFoundError", () =>
            Effect.fail(new NotFound({ id: params.id })),
          ),
          Effect.catchTag("ProjectNotFoundError", () =>
            Effect.fail(new NotFound({ id: params.id })),
          ),
          Effect.catchTag("SealantPlatformError", (error) =>
            Effect.fail(new StoreFailure({ message: error.message })),
          ),
          Effect.catchTags({
            HarnessStateNotFoundError: (error) =>
              Effect.fail(new StoreFailure({ message: error.message })),
            HarnessStateIOError: (error) =>
              Effect.fail(new StoreFailure({ message: error.message })),
            HarnessStateInvalidError: (error) =>
              Effect.fail(new StoreFailure({ message: error.message })),
            HarnessStateCommandError: (error) =>
              Effect.fail(new StoreFailure({ message: error.message })),
          }),
        );
      }),
    )
    .handle("followUpCreate", ({ params, payload }) =>
      Effect.gen(function* () {
        const sessions = yield* SessionsRepo;
        const changes = yield* SessionChangesRepo;
        const followUps = yield* FollowUpsRepo;
        const comments = yield* ReviewCommentsRepo;
        yield* sessions
          .byId(params.id)
          .pipe(Effect.mapError(() => new NotFound({ id: params.id })));
        const change = yield* changes.bySession(params.id);
        if (change === null) return yield* new NotFound({ id: params.id });
        const followUp = yield* followUps.create(params.id, change.id, payload.instruction);
        // The bundle carries the open comments — record where they went.
        const open = yield* comments.listForChange(change.id);
        yield* Effect.forEach(
          open.filter((comment) => comment.state === "open" && comment.sentToSessionId === null),
          (comment) => comments.markSent(comment.id, params.id),
        );
        return followUp;
      }),
    )
    .handle("followUpPending", ({ params }) =>
      Effect.gen(function* () {
        const followUps = yield* FollowUpsRepo;
        return yield* followUps.pendingForSession(params.id);
      }),
    )
    .handle("followUpDeliver", ({ params }) =>
      Effect.gen(function* () {
        const sessions = yield* SessionsRepo;
        const followUps = yield* FollowUpsRepo;
        const pending = yield* followUps.pendingForSession(params.id);
        if (pending === null) return yield* new NotFound({ id: params.id });
        yield* followUps.markDelivered(pending.id);
        yield* sessions.reopen(params.id);
        return new FollowUp({ ...pending, status: "delivered", deliveredAt: new Date() });
      }),
    ),
);

const toFailure = (error: { readonly stderr: string }) =>
  new StoreFailure({ message: error.stderr });

export const SessionChangesGroupLive = HttpApiBuilder.group(MendApi, "sessionChanges", (handlers) =>
  handlers
    .handle("diff", ({ params }) =>
      Effect.gen(function* () {
        const changes = yield* SessionChangesRepo;
        const sessions = yield* SessionsRepo;
        const projects = yield* ProjectsRepo;
        const store = yield* Store;
        const change = yield* changes
          .byId(params.id)
          .pipe(Effect.mapError(() => new NotFound({ id: params.id })));
        const session = yield* sessions
          .byId(change.sessionId)
          .pipe(Effect.mapError(() => new NotFound({ id: change.sessionId })));
        const project = yield* projects
          .byId(change.projectId)
          .pipe(Effect.mapError(() => new NotFound({ id: change.projectId })));
        const worktree = worktreePathOf(project.storePath, session.worktree);
        const diff = yield* store
          .diffWorktree(worktree, change.baseSha)
          .pipe(Effect.mapError(toFailure));
        const files = yield* store
          .changedFiles(worktree, change.baseSha, null)
          .pipe(Effect.mapError(toFailure));
        return new ChangeDiff({
          change,
          diff,
          files: files.map((file) => new ChangedFileView(file)),
        });
      }),
    )
    .handle("read", ({ params }) =>
      Effect.gen(function* () {
        const changes = yield* SessionChangesRepo;
        const jobs = yield* JobRunner;
        yield* changes.byId(params.id).pipe(Effect.mapError(() => new NotFound({ id: params.id })));
        // One pass at a time per change (the key dedups while queued/active);
        // a finished pass can be re-requested and reads the newer state.
        yield* jobs
          .enqueue({
            name: "read-change",
            payload: { changeId: params.id },
            idempotencyKey: `read-change:${params.id}`,
          })
          .pipe(Effect.orDie);
        return { queued: true };
      }),
    )
    .handle("tour", ({ params }) =>
      Effect.gen(function* () {
        const changes = yield* SessionChangesRepo;
        const tours = yield* ChangeToursRepo;
        yield* changes.byId(params.id).pipe(Effect.mapError(() => new NotFound({ id: params.id })));
        return yield* tours.byChange(params.id);
      }),
    )
    .handle("composeTour", ({ params }) =>
      Effect.gen(function* () {
        const changes = yield* SessionChangesRepo;
        const jobs = yield* JobRunner;
        yield* changes.byId(params.id).pipe(Effect.mapError(() => new NotFound({ id: params.id })));
        yield* jobs
          .enqueue({
            name: "compose-tour",
            payload: { changeId: params.id },
            idempotencyKey: `compose-tour:${params.id}`,
          })
          .pipe(Effect.orDie);
        return { queued: true };
      }),
    )
    .handle("suggest", ({ params }) =>
      Effect.gen(function* () {
        const changes = yield* SessionChangesRepo;
        const jobs = yield* JobRunner;
        yield* changes.byId(params.id).pipe(Effect.mapError(() => new NotFound({ id: params.id })));
        // One pass at a time per change; a finished pass can be re-requested.
        yield* jobs
          .enqueue({
            name: "suggest-change",
            payload: { changeId: params.id },
            idempotencyKey: `suggest-change:${params.id}`,
          })
          .pipe(Effect.orDie);
        return { queued: true };
      }),
    )
    .handle("passes", ({ params }) =>
      Effect.gen(function* () {
        const changes = yield* SessionChangesRepo;
        const passes = yield* ChangePassesRepo;
        yield* changes.byId(params.id).pipe(Effect.mapError(() => new NotFound({ id: params.id })));
        return yield* passes.listForChange(params.id);
      }),
    )
    .handle("stats", ({ params }) =>
      Effect.gen(function* () {
        const changes = yield* SessionChangesRepo;
        const sessions = yield* SessionsRepo;
        const projects = yield* ProjectsRepo;
        const store = yield* Store;
        const change = yield* changes
          .byId(params.id)
          .pipe(Effect.mapError(() => new NotFound({ id: params.id })));
        const session = yield* sessions
          .byId(change.sessionId)
          .pipe(Effect.mapError(() => new NotFound({ id: change.sessionId })));
        const project = yield* projects
          .byId(change.projectId)
          .pipe(Effect.mapError(() => new NotFound({ id: change.projectId })));
        const worktree = worktreePathOf(project.storePath, session.worktree);
        const files = yield* store
          .changedFiles(worktree, change.baseSha, null)
          .pipe(Effect.mapError(toFailure));
        return new ChangeStats({
          files: files.length,
          additions: files.reduce((sum, file) => sum + file.additions, 0),
          deletions: files.reduce((sum, file) => sum + file.deletions, 0),
        });
      }),
    )
    .handle("comments", ({ params }) =>
      Effect.gen(function* () {
        const comments = yield* ReviewCommentsRepo;
        return yield* comments.listForChange(params.id);
      }),
    )
    .handle("comment", ({ params, payload }) =>
      Effect.gen(function* () {
        const comments = yield* ReviewCommentsRepo;
        const changes = yield* SessionChangesRepo;
        const user = yield* CurrentUser;
        // The change must exist before a comment can anchor to it.
        yield* changes.byId(params.id).pipe(Effect.mapError(() => new NotFound({ id: params.id })));
        return yield* comments.create({
          changeId: params.id,
          file: payload.file,
          line: payload.line,
          endLine: payload.endLine ?? null,
          authorKind: "reviewer",
          authorName: user.user.name === "" ? user.user.email : user.user.name,
          body: payload.body,
          state: "open",
        });
      }),
    )
    .handle("commentState", ({ params, payload }) =>
      Effect.gen(function* () {
        const comments = yield* ReviewCommentsRepo;
        const existing = yield* comments
          .byId(params.commentId)
          .pipe(Effect.mapError(() => new NotFound({ id: params.commentId })));
        // The comment must anchor to the change in the path — ids are not
        // interchangeable across changes.
        if (existing.changeId !== params.id) {
          return yield* Effect.fail(new NotFound({ id: params.commentId }));
        }
        yield* comments.setState(params.commentId, payload.state);
        return yield* comments
          .byId(params.commentId)
          .pipe(Effect.mapError(() => new NotFound({ id: params.commentId })));
      }),
    ),
);

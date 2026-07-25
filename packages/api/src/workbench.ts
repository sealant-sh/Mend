import {
  CheckpointsRepo,
  FollowUpsRepo,
  ProjectsRepo,
  ReviewCommentsRepo,
  SessionChangesRepo,
  SessionsRepo,
} from "@mend/db";
import { FollowUp } from "@mend/domain/workbench";
import { SessionEngine } from "@mend/sessions";
import { Store, worktreePathOf } from "@mend/store";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import {
  ChangeDiff,
  ChangedFileView,
  CurrentUser,
  MendApi,
  NotFound,
  ProjectDetail,
  SessionDetail,
  StoreFailure,
} from "./contract.ts";

/**
 * The workbench handlers (plan §6): projects, sessions, and the session
 * change. Everything here is host-side — repos, the store, the engine; the
 * platform enters only when a session is launched, which is not an API
 * concern yet (the CLI launches; the API steers and reviews).
 */

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
        const project = yield* projects
          .byId(params.id)
          .pipe(Effect.mapError(() => new NotFound({ id: params.id })));
        const projectSessions = yield* sessions.listForProject(params.id);
        return new ProjectDetail({ project, sessions: projectSessions });
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
        const toFailure = (error: { readonly stderr: string }) =>
          new StoreFailure({ message: error.stderr });
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
    ),
);

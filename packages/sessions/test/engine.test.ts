import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "@effect/vitest";
import {
  CheckpointsRepo,
  ProjectNotFoundError,
  ProjectsRepo,
  SessionChangesRepo,
  SessionNotFoundError,
  SessionsRepo,
  type NewCheckpoint,
  type NewSession,
} from "@mend/db";
import { ChangeId, CheckpointId, ProjectId, SessionId, Sha } from "@mend/domain";
import { Change, Checkpoint, Project, Session } from "@mend/domain/workbench";
import { SealantClient } from "@mend/sealant";
import { SessionEngine } from "@mend/sessions";
import { Store, StoreConfig } from "@mend/store";
import { Effect, Layer, Stream } from "effect";

/** Every platform method dies — these tests exercise the platform-free paths. */
const sealantDeadLayer = Layer.succeed(SealantClient, {
  createWorkspace: () => Effect.die("not in test"),
  getWorkspace: () => Effect.die("not in test"),
  getRun: () => Effect.die("not in test"),
  runHarness: () => Effect.die("not in test"),
  startHarness: () => Effect.die("not in test"),
  startHarnessInWorkspace: () => Effect.die("not in test"),
  waitRun: () => Effect.die("not in test"),
  exec: () => Effect.die("not in test"),
  diffCommits: () => Effect.die("not in test"),
  inferenceRespond: () => Effect.die("not in test"),
  recordStream: () => Stream.fromEffect(Effect.die("not in test")),
  recordTimeline: () => Stream.fromEffect(Effect.die("not in test")),
  runChanges: () => Effect.die("not in test"),
  connectionCheck: () => Effect.die("not in test"),
});

const now = () => new Date();

interface World {
  readonly projects: Map<string, Project>;
  readonly sessions: Map<string, Session>;
  readonly changes: Map<string, Change>;
  readonly checkpoints: Array<Checkpoint>;
}

const makeWorld = (): World => ({
  projects: new Map(),
  sessions: new Map(),
  changes: new Map(),
  checkpoints: [],
});

const projectsLayer = (world: World) =>
  Layer.succeed(ProjectsRepo, {
    create: () => Effect.die("not in test"),
    byId: (id) => {
      const found = world.projects.get(id);
      return found === undefined
        ? Effect.fail(new ProjectNotFoundError({ projectId: id }))
        : Effect.succeed(found);
    },
    byName: () => Effect.succeed(null),
    list: () => Effect.succeed([...world.projects.values()]),
  });

const sessionsLayer = (world: World) => {
  const update = (id: string, patch: Partial<Session>) => {
    const current = world.sessions.get(id);
    if (current !== undefined) {
      world.sessions.set(id, new Session({ ...current, ...patch, updatedAt: now() }));
    }
  };
  return Layer.succeed(SessionsRepo, {
    create: (input: NewSession) =>
      Effect.sync(() => {
        const session = new Session({
          id: input.id,
          projectId: input.projectId,
          harness: input.harness,
          providerSessionId: null,
          label: input.label,
          worktree: input.worktree,
          branch: input.branch,
          baseSha: input.baseSha,
          contextSnapshotId: input.contextSnapshotId,
          sealantRunId: null,
          sealantWorkspaceId: null,
          status: "starting",
          summary: null,
          lastSeenSequence: 0n,
          startedAt: null,
          settledAt: null,
          createdAt: now(),
          updatedAt: now(),
        });
        world.sessions.set(session.id, session);
        return session;
      }),
    byId: (id) => {
      const found = world.sessions.get(id);
      return found === undefined
        ? Effect.fail(new SessionNotFoundError({ sessionId: id }))
        : Effect.succeed(found);
    },
    listForProject: () => Effect.succeed([...world.sessions.values()]),
    listActive: () => Effect.succeed([]),
    listUnsettled: () =>
      Effect.succeed([...world.sessions.values()].filter((s) => s.settledAt === null)),
    setSealantIds: (id, sealantRunId, sealantWorkspaceId) =>
      Effect.sync(() => update(id, { sealantRunId, sealantWorkspaceId })),
    setProviderSessionId: (id, providerSessionId) =>
      Effect.sync(() => update(id, { providerSessionId })),
    setStatus: (id, status) => Effect.sync(() => update(id, { status })),
    saveLastSeenSequence: (id, sequence) =>
      Effect.sync(() => update(id, { lastSeenSequence: sequence })),
    notifyProgress: () => Effect.void,
    settle: (id, outcome, summary) =>
      Effect.sync(() => update(id, { status: outcome, summary, settledAt: now() })),
    reopen: (id) => Effect.sync(() => update(id, { status: "running", settledAt: null })),
  });
};

const changesLayer = (world: World) =>
  Layer.succeed(SessionChangesRepo, {
    ensureForSession: (projectId, sessionId, branch, baseSha) =>
      Effect.sync(() => {
        const existing = world.changes.get(sessionId);
        if (existing !== undefined) return existing;
        const change = new Change({
          id: ChangeId.make(crypto.randomUUID()),
          projectId,
          sessionId,
          branch,
          baseSha,
          headSha: null,
          createdAt: now(),
          updatedAt: now(),
        });
        world.changes.set(sessionId, change);
        return change;
      }),
    byId: () => Effect.die("not in test"),
    bySession: (sessionId) => Effect.succeed(world.changes.get(sessionId) ?? null),
    refreshHead: (id, headSha) =>
      Effect.sync(() => {
        for (const [key, change] of world.changes) {
          if (change.id === id) {
            world.changes.set(key, new Change({ ...change, headSha, updatedAt: now() }));
          }
        }
      }),
  });

const checkpointsLayer = (world: World) =>
  Layer.succeed(CheckpointsRepo, {
    create: (input: NewCheckpoint) =>
      Effect.sync(() => {
        const checkpoint = new Checkpoint({
          id: CheckpointId.make(crypto.randomUUID()),
          sessionId: input.sessionId,
          ref: input.ref,
          sha: input.sha,
          seq: input.seq,
          trigger: input.trigger,
          createdAt: now(),
        });
        world.checkpoints.push(checkpoint);
        return checkpoint;
      }),
    listForSession: (sessionId) =>
      Effect.succeed(world.checkpoints.filter((c) => c.sessionId === sessionId)),
    latestForSession: (sessionId) =>
      Effect.succeed(world.checkpoints.filter((c) => c.sessionId === sessionId).at(-1) ?? null),
    countForSession: (sessionId) =>
      Effect.succeed(world.checkpoints.filter((c) => c.sessionId === sessionId).length),
  });

/** A throwaway origin repo with one commit, adopted into a tmp store. */
const setup = (tmp: string, world: World) => {
  const origin = path.join(tmp, "origin");
  const run = (...args: ReadonlyArray<string>) =>
    execFileSync("git", [...args], {
      cwd: origin,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "origin",
        GIT_AUTHOR_EMAIL: "origin@localhost",
        GIT_COMMITTER_NAME: "origin",
        GIT_COMMITTER_EMAIL: "origin@localhost",
      },
    });
  fs.mkdirSync(origin, { recursive: true });
  run("init", "-b", "main");
  fs.writeFileSync(path.join(origin, "app.ts"), "export const answer = 41\n");
  run("add", "-A");
  run("commit", "-m", "initial");

  return Effect.gen(function* () {
    const store = yield* Store;
    const adopted = yield* store.adopt("fixture", origin);
    const project = new Project({
      id: ProjectId.make("proj-1"),
      name: "fixture",
      originUrl: origin,
      storePath: adopted.storePath,
      defaultBranch: adopted.defaultBranch,
      adoptedSha: Sha.make(adopted.headSha),
      createdAt: now(),
      updatedAt: now(),
    });
    world.projects.set(project.id, project);
    return project;
  });
};

const withEngine = <A, E>(
  work: (world: World, tmp: string) => Effect.Effect<A, E, SessionEngine | Store>,
): Promise<A> => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mend-engine-test-"));
  const world = makeWorld();
  const storeLayer = Store.layer.pipe(Layer.provide(StoreConfig.layerFor(path.join(tmp, "store"))));
  const engineLayer = SessionEngine.layer.pipe(
    Layer.provide(storeLayer),
    Layer.provide(sealantDeadLayer),
    Layer.provide(projectsLayer(world)),
    Layer.provide(sessionsLayer(world)),
    Layer.provide(changesLayer(world)),
    Layer.provide(checkpointsLayer(world)),
  );
  return Effect.runPromise(
    work(world, tmp).pipe(
      Effect.provide(Layer.merge(engineLayer, storeLayer)),
      Effect.ensuring(Effect.sync(() => fs.rmSync(tmp, { recursive: true, force: true }))),
      Effect.orDie,
    ),
  );
};

describe("SessionEngine", () => {
  it("provisions: worktree, session row, checkpoint 0, change row", async () => {
    await withEngine((world, tmp) =>
      Effect.gen(function* () {
        const project = yield* setup(tmp, world);
        const engine = yield* SessionEngine;

        const session = yield* engine.provision({
          projectId: project.id,
          harness: "codex",
          label: "fix the answer",
          base: null,
        });

        expect(session.branch).toBe(`mend/session/${session.id}`);
        expect(session.status).toBe("starting");
        const worktree = path.join(tmp, "store", "fixture", "worktrees", session.worktree);
        expect(fs.existsSync(path.join(worktree, "app.ts"))).toBe(true);

        const cps = world.checkpoints.filter((c) => c.sessionId === session.id);
        expect(cps).toHaveLength(1);
        expect(cps[0]?.trigger).toBe("session-start");
        expect(cps[0]?.seq).toBe(0n);

        const change = world.changes.get(session.id);
        expect(change?.baseSha).toBe(session.baseSha);
      }),
    );
  });

  it("checkpointNow snapshots edits and refreshes the change head", async () => {
    await withEngine((world, tmp) =>
      Effect.gen(function* () {
        const project = yield* setup(tmp, world);
        const engine = yield* SessionEngine;
        const session = yield* engine.provision({
          projectId: project.id,
          harness: "codex",
          label: null,
          base: null,
        });

        const worktree = path.join(tmp, "store", "fixture", "worktrees", session.worktree);
        fs.writeFileSync(path.join(worktree, "app.ts"), "export const answer = 42\n");

        const checkpoint = yield* engine.checkpointNow(session.id, "user-mark");
        expect(checkpoint.trigger).toBe("user-mark");
        expect(checkpoint.ref).toContain(`refs/mend/checkpoints/${session.id}/1`);

        const change = world.changes.get(session.id);
        expect(change?.headSha).toBe(checkpoint.sha);

        // The slice cp0..cp1 carries exactly the edit.
        const store = yield* Store;
        const cp0 = world.checkpoints.find((c) => c.sessionId === session.id && c.seq === 0n);
        const diff = yield* store.diffRange(worktree, String(cp0?.sha), String(checkpoint.sha));
        expect(diff).toContain("+export const answer = 42");
      }),
    );
  });

  it("stop settles the session and leaves a final mark", async () => {
    await withEngine((world, tmp) =>
      Effect.gen(function* () {
        const project = yield* setup(tmp, world);
        const engine = yield* SessionEngine;
        const session = yield* engine.provision({
          projectId: project.id,
          harness: "custom",
          label: null,
          base: null,
        });

        yield* engine.stop(session.id);

        const settled = world.sessions.get(session.id);
        expect(settled?.status).toBe("stopped");
        expect(settled?.settledAt).not.toBeNull();
        const marks = world.checkpoints.filter(
          (c) => c.sessionId === session.id && c.trigger === "user-mark",
        );
        expect(marks).toHaveLength(1);
      }),
    );
  });

  it("resume fails sessions that died before the harness started", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mend-engine-resume-"));
    const world = makeWorld();
    // An unsettled session with no Sealant run — the crash-before-start case.
    const orphan = new Session({
      id: SessionId.make(crypto.randomUUID()),
      projectId: ProjectId.make("proj-1"),
      harness: "codex",
      providerSessionId: null,
      label: null,
      worktree: "session-x",
      branch: "mend/session/x",
      baseSha: Sha.make("0000000000000000000000000000000000000000"),
      contextSnapshotId: null,
      sealantRunId: null,
      sealantWorkspaceId: null,
      status: "running",
      summary: null,
      lastSeenSequence: 0n,
      startedAt: now(),
      settledAt: null,
      createdAt: now(),
      updatedAt: now(),
    });
    world.sessions.set(orphan.id, orphan);

    const storeLayer = Store.layer.pipe(
      Layer.provide(StoreConfig.layerFor(path.join(tmp, "store"))),
    );
    const engineLayer = SessionEngine.layer.pipe(
      Layer.provide(storeLayer),
      Layer.provide(sealantDeadLayer),
      Layer.provide(projectsLayer(world)),
      Layer.provide(sessionsLayer(world)),
      Layer.provide(changesLayer(world)),
      Layer.provide(checkpointsLayer(world)),
    );
    // Constructing the engine runs resume().
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* SessionEngine;
      }).pipe(
        Effect.provide(engineLayer),
        Effect.ensuring(Effect.sync(() => fs.rmSync(tmp, { recursive: true, force: true }))),
        Effect.orDie,
      ),
    );
    const settled = world.sessions.get(orphan.id);
    expect(settled?.status).toBe("failed");
    expect(settled?.summary).toContain("restarted before the harness started");
  });
});

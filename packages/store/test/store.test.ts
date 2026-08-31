import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { SessionId } from "@mend/domain";
import { Effect, Layer } from "effect";

import { Store, StoreConfig } from "../src/store.ts";

const sessionId = SessionId.make("01TEST");
/** Worktree identity as the engine derives it for unnamed worktrees. */
const wtIdentity = (id: string) => ({ directory: `wt-${id}`, branch: `mend/wt/${id}` });

/** True when the mode carries the shared-group contract: setgid + group rwx. */
const setgidGroupWrite = (target: string) => {
  const mode = fs.statSync(target).mode & 0o7777;
  return (mode & 0o2070) === 0o2070;
};

/** A throwaway origin repo with one commit — what a user would adopt. */
const makeOrigin = (dir: string) => {
  const run = (...args: ReadonlyArray<string>) =>
    execFileSync("git", [...args], {
      cwd: dir,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "origin",
        GIT_AUTHOR_EMAIL: "origin@localhost",
        GIT_COMMITTER_NAME: "origin",
        GIT_COMMITTER_EMAIL: "origin@localhost",
      },
    });
  fs.mkdirSync(dir, { recursive: true });
  run("init", "-b", "main");
  fs.writeFileSync(path.join(dir, "README.md"), "# fixture\n");
  fs.writeFileSync(path.join(dir, "app.ts"), "export const answer = 41\n");
  run("add", "-A");
  run("commit", "-m", "initial");
};

const withStore = <A, E>(work: (tmp: string) => Effect.Effect<A, E, Store>): Promise<A> => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mend-store-test-"));
  const storeLayer = Store.layer.pipe(Layer.provide(StoreConfig.layerFor(path.join(tmp, "store"))));
  return Effect.runPromise(
    work(tmp).pipe(
      Effect.provide(storeLayer),
      Effect.ensuring(Effect.sync(() => fs.rmSync(tmp, { recursive: true, force: true }))),
      Effect.orDie,
    ),
  );
};

describe("Store", () => {
  it("adopts, worktrees, checkpoints, and slices", async () => {
    await withStore((tmp) =>
      Effect.gen(function* () {
        const store = yield* Store;
        const origin = path.join(tmp, "origin");
        makeOrigin(origin);

        // Adopt: bare clone in the store, default branch discovered.
        const adopted = yield* store.adopt("fixture", origin, { GIT_TERMINAL_PROMPT: "0" });
        expect(adopted.defaultBranch).toBe("main");
        expect(fs.existsSync(adopted.storePath)).toBe(true);

        // Session worktree on its own branch from the default branch.
        const wt = yield* store.createWorktree(adopted.storePath, wtIdentity(sessionId), null, null);
        expect(wt.branch).toBe(`mend/wt/${sessionId}`);
        expect(wt.baseSha).toBe(adopted.headSha);
        expect(wt.baseRef).toBe("main");
        expect(fs.existsSync(path.join(wt.path, "app.ts"))).toBe(true);

        // "Agent" edits a tracked file and adds an untracked one.
        fs.writeFileSync(path.join(wt.path, "app.ts"), "export const answer = 42\n");
        const cp1 = yield* store.checkpoint(wt.path, sessionId, 1, null);

        fs.writeFileSync(path.join(wt.path, "extra.ts"), "export const extra = true\n");
        const cp2 = yield* store.checkpoint(wt.path, sessionId, 2, cp1.sha);

        // Checkpoints never touch the visible branch, HEAD, or the files.
        const head = yield* store.headSha(wt.path);
        expect(head).toBe(adopted.headSha);
        expect(fs.readFileSync(path.join(wt.path, "app.ts"), "utf8")).toContain("42");

        // The slice cp1..cp2 contains only the untracked-then-snapshotted file.
        const slice = yield* store.diffRange(wt.path, cp1.sha, cp2.sha);
        expect(slice).toContain("extra.ts");
        expect(slice).not.toContain("answer");

        // Full change: worktree vs base sees the tracked edit AND the untracked file.
        const full = yield* store.diffWorktree(wt.path, wt.baseSha);
        expect(full).toContain("-export const answer = 41");
        expect(full).toContain("+export const answer = 42");
        expect(full).toContain("extra.ts");
        const liveFiles = yield* store.changedFiles(wt.path, wt.baseSha, null);
        expect(liveFiles.map((f) => f.path).toSorted()).toEqual(["app.ts", "extra.ts"]);

        // Per-file counts across base → cp2 (includes the untracked file via the snapshot).
        const files = yield* store.changedFiles(wt.path, wt.baseSha, cp2.sha);
        const paths = files.map((f) => f.path).toSorted();
        expect(paths).toEqual(["app.ts", "extra.ts"]);
        expect(yield* store.worktreeMatchesCommit(wt.path, cp2.sha)).toBe(true);

        fs.renameSync(path.join(wt.path, "extra.ts"), path.join(wt.path, "renamed.ts"));
        fs.writeFileSync(path.join(wt.path, "asset.bin"), Buffer.from([0, 1, 2, 3]));
        expect(yield* store.worktreeMatchesCommit(wt.path, cp2.sha)).toBe(false);
        const cp3 = yield* store.checkpoint(wt.path, sessionId, 3, cp2.sha);
        execFileSync("git", ["config", "diff.renames", "false"], { cwd: wt.path });
        const renamePatch = yield* store.diffRange(wt.path, cp2.sha, cp3.sha);
        expect(renamePatch).toContain("rename from extra.ts");
        expect(yield* store.worktreeMatchesCommit(wt.path, cp3.sha)).toBe(true);
        const facts = yield* store.diffFileFacts(wt.path, cp2.sha, cp3.sha);
        expect(facts).toEqual([
          {
            oldPath: null,
            newPath: "asset.bin",
            status: "added",
            additions: 0,
            deletions: 0,
            binary: true,
          },
          {
            oldPath: "extra.ts",
            newPath: "renamed.ts",
            status: "renamed",
            additions: 0,
            deletions: 0,
            binary: false,
          },
        ]);

        // Review rendering options stay paired: a whitespace-only edit disappears
        // from both the patch and its file facts when whitespace is ignored.
        fs.writeFileSync(path.join(wt.path, "app.ts"), "export  const answer = 42\n");
        const cp4 = yield* store.checkpoint(wt.path, sessionId, 4, cp3.sha);
        expect(yield* store.diffRange(wt.path, cp3.sha, cp4.sha)).toContain("app.ts");
        expect(yield* store.diffRange(wt.path, cp3.sha, cp4.sha, { ignoreWhitespace: true })).toBe(
          "",
        );
        expect(yield* store.diffFileFacts(wt.path, cp3.sha, cp4.sha)).toHaveLength(1);
        expect(
          yield* store.diffFileFacts(wt.path, cp3.sha, cp4.sha, { ignoreWhitespace: true }),
        ).toEqual([]);
        const noContext = yield* store.diffRange(wt.path, cp3.sha, cp4.sha, { contextLines: 0 });
        expect(noContext).toContain("@@ -1 +1 @@");

        // Worktree removal leaves the checkpoint refs intact in the bare repo.
        yield* store.removeWorktree(adopted.storePath, wt.name);
        const survivingDiff = yield* store.diffRange(adopted.storePath, cp1.sha, cp2.sha);
        expect(survivingDiff).toContain("extra.ts");
      }),
    );
  });

  it("keeps the store group-writable so a root-side git cannot lock uid 1000 out", async () => {
    await withStore((tmp) =>
      Effect.gen(function* () {
        const store = yield* Store;
        const origin = path.join(tmp, "origin");
        makeOrigin(origin);
        const adopted = yield* store.adopt("fixture", origin, { GIT_TERMINAL_PROMPT: "0" });

        const shared = () =>
          execFileSync("git", ["config", "--get", "core.sharedRepository"], {
            cwd: adopted.storePath,
          })
            .toString()
            .trim();

        // Adoption applies the policy: config + setgid group-writable directories, so files a
        // root-side `git gc` creates stay writable by this uid through the shared group.
        expect(shared()).toBe("group");
        expect(setgidGroupWrite(path.join(adopted.storePath, "refs"))).toBe(true);
        expect(setgidGroupWrite(path.join(adopted.storePath, "refs", "heads"))).toBe(true);

        // A store from before the policy heals on the next worktree create.
        execFileSync("git", ["config", "--unset", "core.sharedRepository"], {
          cwd: adopted.storePath,
        });
        fs.chmodSync(path.join(adopted.storePath, "refs"), 0o755);
        const wt = yield* store.createWorktree(adopted.storePath, wtIdentity(sessionId), null, null);
        expect(shared()).toBe("group");
        expect(setgidGroupWrite(path.join(adopted.storePath, "refs"))).toBe(true);
        // The worktree's own gitdir metadata (where checkpoints write) is covered too.
        expect(setgidGroupWrite(path.join(adopted.storePath, "worktrees", wt.name))).toBe(true);
      }),
    );
  });

  it("freshens bases from origin, lists branches, and refreshes", async () => {
    await withStore((tmp) =>
      Effect.gen(function* () {
        const store = yield* Store;
        const origin = path.join(tmp, "origin");
        makeOrigin(origin);
        const runOrigin = (...args: ReadonlyArray<string>) =>
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

        const adopted = yield* store.adopt("fixture", origin, { GIT_TERMINAL_PROMPT: "0" });

        // Origin moves on after adoption: main advances, a feature branch appears.
        fs.writeFileSync(path.join(origin, "app.ts"), "export const answer = 42\n");
        runOrigin("commit", "-am", "advance main");
        const newMainSha = String(runOrigin("rev-parse", "HEAD")).trim();
        runOrigin("checkout", "-b", "feature/x");
        fs.writeFileSync(path.join(origin, "feature.ts"), "export const x = 1\n");
        runOrigin("add", "-A");
        runOrigin("commit", "-m", "feature work");
        const featureSha = String(runOrigin("rev-parse", "HEAD")).trim();
        runOrigin("checkout", "main");

        // A worktree with remoteEnv freshens: it bases on origin's CURRENT main,
        // not the store's adoption-time head.
        const fresh = yield* store.createWorktree(adopted.storePath, wtIdentity(sessionId), null, {
          GIT_TERMINAL_PROMPT: "0",
        });
        expect(fresh.baseRef).toBe("main");
        expect(fresh.baseSha).toBe(newMainSha);
        expect(fresh.baseSha).not.toBe(adopted.headSha);

        // A never-fetched branch resolves too, by name, at origin's tip.
        const onFeature = yield* store.createWorktree(
          adopted.storePath,
          wtIdentity("01TEST2"),
          "feature/x",
          { GIT_TERMINAL_PROMPT: "0" },
        );
        expect(onFeature.baseRef).toBe("feature/x");
        expect(onFeature.baseSha).toBe(featureSha);

        // Null remoteEnv skips the fetch — offline still provisions, on what the store has.
        const offline = yield* store.createWorktree(
          adopted.storePath,
          wtIdentity("01TEST3"),
          null,
          null,
        );
        expect(offline.baseSha).toBe(newMainSha); // already fetched above

        // Refresh pulls every head; the listing reads current, session branches never appear.
        yield* store.refreshFromOrigin(adopted.storePath, { GIT_TERMINAL_PROMPT: "0" });
        const branches = yield* store.listBranches(adopted.storePath);
        const names = branches.map((b) => b.name);
        expect(names).toContain("main");
        expect(names).toContain("feature/x");
        expect(names.some((n) => n.startsWith("mend/session/") || n.startsWith("mend/wt/"))).toBe(false);
        expect(branches.find((b) => b.name === "main")?.isDefault).toBe(true);
        expect(branches.find((b) => b.name === "main")?.sha).toBe(newMainSha);
        expect(branches.find((b) => b.name === "feature/x")?.sha).toBe(featureSha);
      }),
    );
  });
});

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { SessionId } from "@mend/domain";
import { Effect, Layer } from "effect";

import { Store, StoreConfig } from "../src/store.ts";

const sessionId = SessionId.make("01TEST");

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
        const adopted = yield* store.adopt("fixture", origin);
        expect(adopted.defaultBranch).toBe("main");
        expect(fs.existsSync(adopted.storePath)).toBe(true);

        // Session worktree on its own branch from the default branch.
        const wt = yield* store.createWorktree(adopted.storePath, sessionId, null);
        expect(wt.branch).toBe(`mend/session/${sessionId}`);
        expect(wt.baseSha).toBe(adopted.headSha);
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

        // Full change: worktree vs base sees the tracked edit.
        const full = yield* store.diffWorktree(wt.path, wt.baseSha);
        expect(full).toContain("-export const answer = 41");
        expect(full).toContain("+export const answer = 42");

        // Per-file counts across base → cp2 (includes the untracked file via the snapshot).
        const files = yield* store.changedFiles(wt.path, wt.baseSha, cp2.sha);
        const paths = files.map((f) => f.path).sort();
        expect(paths).toEqual(["app.ts", "extra.ts"]);

        // Worktree removal leaves the checkpoint refs intact in the bare repo.
        yield* store.removeWorktree(adopted.storePath, wt.name);
        const survivingDiff = yield* store.diffRange(adopted.storePath, cp1.sha, cp2.sha);
        expect(survivingDiff).toContain("extra.ts");
      }),
    );
  });
});

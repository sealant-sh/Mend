import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { Sha, type SessionId } from "@mend/domain";
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

import { git, GitError } from "./git.ts";

/** Where the store lives on disk. One root, one directory per project. */
export class StoreConfig extends Context.Service<
  StoreConfig,
  {
    readonly root: string;
  }
>()("@mend/store/StoreConfig") {
  static readonly layer = Layer.effect(
    StoreConfig,
    Effect.sync(() => ({
      root: process.env["MEND_STORE_ROOT"] ?? path.join(os.homedir(), ".mend", "store"),
    })),
  );
  static readonly layerFor = (root: string) => Layer.succeed(StoreConfig, { root });
}

export class AdoptError extends Schema.TaggedErrorClass<AdoptError>()("AdoptError", {
  name: Schema.String,
  source: Schema.String,
  cause: GitError,
}) {}

export interface AdoptedRepo {
  /** Absolute path of the bare repo: `<root>/<name>/repo.git`. */
  readonly storePath: string;
  readonly defaultBranch: string;
  readonly headSha: Sha;
}

export interface SessionWorktree {
  /** Absolute path of the worktree directory. */
  readonly path: string;
  /** Directory name inside `<root>/<name>/worktrees/`. */
  readonly name: string;
  readonly branch: string;
  readonly baseSha: Sha;
}

export interface CheckpointSnapshot {
  readonly ref: string;
  readonly sha: Sha;
}

export interface ChangedFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

const sha = (value: string) => Sha.make(value);

/** Where a named worktree lives relative to its project's bare repo. */
export const worktreePathOf = (storePath: string, name: string) =>
  path.join(path.dirname(storePath), "worktrees", name);

/**
 * The central repository store (plan §5.2, §8.1.A): bare clone per project,
 * one git worktree per session, checkpoints as commits on hidden refs that
 * never touch the visible branch. Everything here is host-side plain git —
 * no Sealant dependency; workspaces mount the worktrees this service creates.
 */
export class Store extends Context.Service<
  Store,
  {
    /** Clone `source` (URL or local path) into the store as a bare repo. */
    readonly adopt: (name: string, source: string) => Effect.Effect<AdoptedRepo, AdoptError>;
    /** Create the session's worktree on its own branch from `base` (default branch when null). */
    readonly createWorktree: (
      storePath: string,
      sessionId: SessionId,
      base: string | null,
    ) => Effect.Effect<SessionWorktree, GitError>;
    /** Remove a session worktree; checkpoint refs survive in the bare repo. */
    readonly removeWorktree: (storePath: string, name: string) => Effect.Effect<void, GitError>;
    /**
     * Snapshot the worktree without touching HEAD, index, or files: throwaway
     * index → write-tree → commit-tree (parented on the previous checkpoint)
     * → update-ref `refs/mend/checkpoints/<sessionId>/<n>`.
     */
    readonly checkpoint: (
      worktreePath: string,
      sessionId: SessionId,
      index: number,
      parent: Sha | null,
    ) => Effect.Effect<CheckpointSnapshot, GitError>;
    /** Unified diff between two commits (a checkpoint slice: `refA..refB`). */
    readonly diffRange: (dir: string, a: string, b: string) => Effect.Effect<string, GitError>;
    /** Unified diff of the live worktree against a base commit. */
    readonly diffWorktree: (worktreePath: string, base: string) => Effect.Effect<string, GitError>;
    /** Per-file +/− counts for a range (`--numstat`); binary files count as 0/0. */
    readonly changedFiles: (
      dir: string,
      a: string,
      b: string | null,
    ) => Effect.Effect<ReadonlyArray<ChangedFile>, GitError>;
    readonly headSha: (dir: string) => Effect.Effect<Sha, GitError>;
  }
>()("@mend/store/Store") {
  static readonly layer = Layer.effect(
    Store,
    Effect.gen(function* () {
      const config = yield* StoreConfig;

      const adopt = Effect.fn("Store.adopt")(function* (name: string, source: string) {
        const projectDir = path.join(config.root, name);
        const storePath = path.join(projectDir, "repo.git");
        const attempt = Effect.gen(function* () {
          yield* Effect.sync(() => fs.mkdirSync(config.root, { recursive: true }));
          yield* git(["clone", "--bare", source, storePath], config.root, {
            GIT_TERMINAL_PROMPT: "0",
          });
          // Bare clones don't fetch new branches by default — make later syncs sane.
          yield* git(
            ["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"],
            storePath,
          );
          const defaultBranch = yield* git(["symbolic-ref", "--short", "HEAD"], storePath);
          const head = yield* git(["rev-parse", "HEAD"], storePath);
          return { storePath, defaultBranch, headSha: sha(head) };
        });
        return yield* attempt.pipe(
          Effect.catch((cause) => Effect.fail(new AdoptError({ name, source, cause }))),
        );
      });

      const createWorktree = Effect.fn("Store.createWorktree")(function* (
        storePath: string,
        sessionId: SessionId,
        base: string | null,
      ) {
        const baseRef = base ?? (yield* git(["symbolic-ref", "--short", "HEAD"], storePath));
        const baseSha = yield* git(["rev-parse", `${baseRef}^{commit}`], storePath);
        const name = `session-${sessionId}`;
        const branch = `mend/session/${sessionId}`;
        const worktreePath = path.join(path.dirname(storePath), "worktrees", name);
        yield* git(["worktree", "add", "-b", branch, worktreePath, baseSha], storePath);
        return { path: worktreePath, name, branch, baseSha: sha(baseSha) };
      });

      const removeWorktree = Effect.fn("Store.removeWorktree")(function* (
        storePath: string,
        name: string,
      ) {
        const worktreePath = path.join(path.dirname(storePath), "worktrees", name);
        yield* git(["worktree", "remove", "--force", worktreePath], storePath);
      });

      const checkpoint = Effect.fn("Store.checkpoint")(function* (
        worktreePath: string,
        sessionId: SessionId,
        index: number,
        parent: Sha | null,
      ) {
        const tmpIndex = path.join(
          os.tmpdir(),
          `mend-checkpoint-${sessionId}-${index}-${process.pid}`,
        );
        const env = { GIT_INDEX_FILE: tmpIndex };
        const snapshot = Effect.gen(function* () {
          yield* git(["add", "-A"], worktreePath, env);
          const tree = yield* git(["write-tree"], worktreePath, env);
          const message = `mend checkpoint ${index}`;
          const commitArgs =
            parent === null
              ? ["commit-tree", tree, "-m", message]
              : ["commit-tree", tree, "-p", parent, "-m", message];
          const commit = yield* git(commitArgs, worktreePath);
          const ref = `refs/mend/checkpoints/${sessionId}/${index}`;
          yield* git(["update-ref", ref, commit], worktreePath);
          return { ref, sha: sha(commit) };
        });
        return yield* snapshot.pipe(
          Effect.ensuring(Effect.sync(() => fs.rmSync(tmpIndex, { force: true }))),
        );
      });

      const diffRange = Effect.fn("Store.diffRange")(function* (dir: string, a: string, b: string) {
        return yield* git(["diff", a, b], dir);
      });

      const diffWorktree = Effect.fn("Store.diffWorktree")(function* (
        worktreePath: string,
        base: string,
      ) {
        return yield* git(["diff", base], worktreePath);
      });

      const changedFiles = Effect.fn("Store.changedFiles")(function* (
        dir: string,
        a: string,
        b: string | null,
      ) {
        const args = b === null ? ["diff", "--numstat", a] : ["diff", "--numstat", a, b];
        const out = yield* git(args, dir);
        if (out === "") return [];
        return out.split("\n").map((line) => {
          const [additions = "0", deletions = "0", ...rest] = line.split("\t");
          return {
            path: rest.join("\t"),
            additions: additions === "-" ? 0 : Number(additions),
            deletions: deletions === "-" ? 0 : Number(deletions),
          };
        });
      });

      const headSha = Effect.fn("Store.headSha")(function* (dir: string) {
        const head = yield* git(["rev-parse", "HEAD"], dir);
        return sha(head);
      });

      return {
        adopt,
        createWorktree,
        removeWorktree,
        checkpoint,
        diffRange,
        diffWorktree,
        changedFiles,
        headSha,
      };
    }),
  );
}

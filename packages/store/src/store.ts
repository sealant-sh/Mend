import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { Sha, type SessionId } from "@mend/domain";
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

import { git, GitError } from "./git.ts";
import { mendHome } from "./paths.ts";

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
      root: process.env["MEND_STORE_ROOT"] ?? path.join(mendHome(), "store"),
    })),
  );
  static readonly layerFor = (root: string) => Layer.succeed(StoreConfig, { root });
}

export class AdoptError extends Schema.TaggedErrorClass<AdoptError>()("AdoptError", {
  name: Schema.String,
  source: Schema.String,
  cause: GitError,
}) {}

/** Named to dodge the JS global `ReferenceError`; same shape as `AdoptError`. */
export class ReferenceCloneError extends Schema.TaggedErrorClass<ReferenceCloneError>()(
  "ReferenceCloneError",
  {
    name: Schema.String,
    source: Schema.String,
    cause: GitError,
  },
) {}

export interface ReferenceClone {
  /** Absolute path of the working clone: `<root>/_references/<name>`. */
  readonly path: string;
  readonly headSha: Sha;
}

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

/** Untracked paths — invisible to `git diff <base>` but part of the change. */
const untrackedIn = (worktreePath: string) =>
  git(["ls-files", "--others", "--exclude-standard"], worktreePath).pipe(
    Effect.map((out) => (out === "" ? [] : out.split("\n"))),
  );

const rmBestEffort = (target: string): { readonly leftover: string | null } => {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    // EACCES on container-uid files — what survives is reported by the caller.
  }
  return { leftover: fs.existsSync(target) ? target : null };
};

/** Where a named worktree lives relative to its project's bare repo. */
export const worktreePathOf = (storePath: string, name: string) =>
  path.join(path.dirname(storePath), "worktrees", name);

/**
 * Where a session's harvested harness state lives (plan: the session store).
 * Holds the raw native state tarball, the primary transcript, and the
 * manifest — written automatically at settle, read automatically at relaunch.
 */
export const sessionStatePathOf = (storePath: string, sessionId: string) =>
  path.join(path.dirname(storePath), "sessions", sessionId);

/**
 * The central repository store (plan §5.2, §8.1.A): bare clone per project,
 * one git worktree per session, checkpoints as commits on hidden refs that
 * never touch the visible branch. Everything here is host-side plain git —
 * no Sealant dependency; workspaces mount the worktrees this service creates.
 */
export class Store extends Context.Service<
  Store,
  {
    /**
     * Clone `source` (URL or local path) into the store as a bare repo.
     * `remoteEnv` carries the resolved auth (`GIT_SSH_COMMAND`, prompt policy)
     * from the git-auth seam — the store itself never decides credentials.
     */
    readonly adopt: (
      name: string,
      source: string,
      remoteEnv: Record<string, string>,
    ) => Effect.Effect<AdoptedRepo, AdoptError>;
    /** Create the session's worktree on its own branch from `base` (default branch when null). */
    readonly createWorktree: (
      storePath: string,
      sessionId: SessionId,
      base: string | null,
    ) => Effect.Effect<SessionWorktree, GitError>;
    /**
     * Freshen an existing worktree to `base` (default branch when null) without recreating it:
     * hard-reset the session branch, then clean untracked files. Ignore rules — including the
     * store-level excludes — keep dependency stores in place. For a bind-mounted worktree the
     * reset is immediately visible inside a running workspace.
     */
    readonly resetWorktree: (
      storePath: string,
      name: string,
      base: string | null,
    ) => Effect.Effect<{ readonly path: string; readonly baseSha: Sha }, GitError>;
    /** Remove a session worktree; checkpoint refs survive in the bare repo. */
    readonly removeWorktree: (storePath: string, name: string) => Effect.Effect<void, GitError>;
    /**
     * Best-effort worktree removal for session deletion: git first, then a
     * plain rm for what git refuses (container-uid files from workspace
     * builds). Never fails — a surviving path is reported, not thrown.
     */
    readonly removeWorktreeForce: (
      storePath: string,
      name: string,
    ) => Effect.Effect<{ readonly leftover: string | null }>;
    /**
     * Remove the project's whole store directory (bare repo + worktrees).
     * Same honesty contract: a path that would not delete is the answer.
     */
    readonly removeProjectStore: (
      storePath: string,
    ) => Effect.Effect<{ readonly leftover: string | null }>;
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
    /**
     * Clone `source` shallow into `_references/<name>` as read-only source
     * material (plan §17, decided 2026-08-01). `ref` pins a branch or tag;
     * null follows the remote's default branch. A working clone, not bare —
     * the point is an agent reading files.
     */
    readonly cloneReference: (
      name: string,
      source: string,
      ref: string | null,
      remoteEnv: Record<string, string>,
    ) => Effect.Effect<ReferenceClone, ReferenceCloneError>;
    /** Re-fetch the pinned ref (or the clone's branch) shallow and hard-reset to it. */
    readonly refreshReference: (
      clonePath: string,
      ref: string | null,
      remoteEnv: Record<string, string>,
    ) => Effect.Effect<ReferenceClone, GitError>;
    /** Delete the clone directory. Selection rows are the caller's concern. */
    readonly removeReference: (clonePath: string) => Effect.Effect<void>;
  }
>()("@mend/store/Store") {
  static readonly layer = Layer.effect(
    Store,
    Effect.gen(function* () {
      const config = yield* StoreConfig;

      /**
       * Dependency and artifact stores are never review content. This is
       * git-level policy — `$GIT_COMMON_DIR/info/exclude`, which every linked
       * worktree inherits — so diffs, status, and checkpoints all agree,
       * without touching the project's own .gitignore. Found live: a workspace
       * `pnpm install` dumped `.pnpm-store` (62k files) into the worktree of a
       * repo that doesn't ignore it, and the review diff drowned.
       */
      const MEND_EXCLUDES = ["node_modules/", ".pnpm-store/", ".npm/", "__pycache__/", ".venv/"];
      const ensureExcludes = (storePath: string) =>
        Effect.sync(() => {
          const file = path.join(storePath, "info", "exclude");
          fs.mkdirSync(path.dirname(file), { recursive: true });
          const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
          const missing = MEND_EXCLUDES.filter((entry) => !current.includes(entry));
          if (missing.length > 0) {
            fs.appendFileSync(
              file,
              `\n# mend: dependency stores are not review content\n${missing.join("\n")}\n`,
            );
          }
        });

      const adopt = Effect.fn("Store.adopt")(function* (
        name: string,
        source: string,
        remoteEnv: Record<string, string>,
      ) {
        const projectDir = path.join(config.root, name);
        const storePath = path.join(projectDir, "repo.git");
        const attempt = Effect.gen(function* () {
          yield* Effect.sync(() => fs.mkdirSync(config.root, { recursive: true }));
          yield* git(["clone", "--bare", source, storePath], config.root, remoteEnv);
          // Bare clones don't fetch new branches by default — make later syncs sane.
          yield* git(
            ["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"],
            storePath,
          );
          yield* ensureExcludes(storePath);
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
        // Idempotent: stores adopted before the exclude policy get it here.
        yield* ensureExcludes(storePath);
        const baseRef = base ?? (yield* git(["symbolic-ref", "--short", "HEAD"], storePath));
        const baseSha = yield* git(["rev-parse", `${baseRef}^{commit}`], storePath);
        const name = `session-${sessionId}`;
        const branch = `mend/session/${sessionId}`;
        const worktreePath = path.join(path.dirname(storePath), "worktrees", name);
        yield* git(["worktree", "add", "-b", branch, worktreePath, baseSha], storePath);
        return { path: worktreePath, name, branch, baseSha: sha(baseSha) };
      });

      const resetWorktree = Effect.fn("Store.resetWorktree")(function* (
        storePath: string,
        name: string,
        base: string | null,
      ) {
        const worktreePath = path.join(path.dirname(storePath), "worktrees", name);
        const baseRef = base ?? (yield* git(["symbolic-ref", "--short", "HEAD"], storePath));
        const baseSha = yield* git(["rev-parse", `${baseRef}^{commit}`], storePath);
        yield* git(["reset", "--hard", baseSha], worktreePath);
        yield* git(["clean", "-fd"], worktreePath);
        return { path: worktreePath, baseSha: sha(baseSha) };
      });

      const removeWorktree = Effect.fn("Store.removeWorktree")(function* (
        storePath: string,
        name: string,
      ) {
        const worktreePath = path.join(path.dirname(storePath), "worktrees", name);
        yield* git(["worktree", "remove", "--force", worktreePath], storePath);
      });

      const removeWorktreeForce = Effect.fn("Store.removeWorktreeForce")(function* (
        storePath: string,
        name: string,
      ) {
        const worktreePath = path.join(path.dirname(storePath), "worktrees", name);
        yield* git(["worktree", "remove", "--force", worktreePath], storePath).pipe(Effect.ignore);
        const result = yield* Effect.sync(() => rmBestEffort(worktreePath));
        // Drop the stale registration when the directory did go away.
        yield* git(["worktree", "prune"], storePath).pipe(Effect.ignore);
        return result;
      });

      const removeProjectStore = Effect.fn("Store.removeProjectStore")(function* (
        storePath: string,
      ) {
        return yield* Effect.sync(() => rmBestEffort(path.dirname(storePath)));
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

      /**
       * Rendering an untracked file costs one `git diff --no-index` spawn, so
       * an unreviewable explosion (a dependency store dumped into the worktree
       * escaped every ignore rule once: 62k files, one spawn each — the review
       * page "hung") is capped hard. The excluded tail is a count the caller
       * can surface; it is never silently dropped git-side.
       */
      const UNTRACKED_RENDER_LIMIT = 200;

      const diffWorktree = Effect.fn("Store.diffWorktree")(function* (
        worktreePath: string,
        base: string,
      ) {
        const tracked = yield* git(["diff", base], worktreePath);
        const untracked = yield* untrackedIn(worktreePath);
        const rendered = untracked.slice(0, UNTRACKED_RENDER_LIMIT);
        if (untracked.length > rendered.length) {
          yield* Effect.logWarning("store: untracked files over render limit").pipe(
            Effect.annotateLogs({ worktreePath, untracked: untracked.length }),
          );
        }
        const additions = yield* Effect.forEach(rendered, (file) =>
          // Exit 1 means "the files differ" — for /dev/null vs a new file, that IS the diff.
          git(["diff", "--no-index", "--", "/dev/null", file], worktreePath, undefined, [1]),
        );
        return [tracked, ...additions].filter((part) => part !== "").join("\n");
      });

      const changedFiles = Effect.fn("Store.changedFiles")(function* (
        dir: string,
        a: string,
        b: string | null,
      ) {
        const args = b === null ? ["diff", "--numstat", a] : ["diff", "--numstat", a, b];
        const out = yield* git(args, dir);
        const tracked =
          out === ""
            ? []
            : out.split("\n").map((line) => {
                const [additions = "0", deletions = "0", ...rest] = line.split("\t");
                return {
                  path: rest.join("\t"),
                  additions: additions === "-" ? 0 : Number(additions),
                  deletions: deletions === "-" ? 0 : Number(deletions),
                };
              });
        // A live-worktree comparison (b = null) also owns its untracked files.
        if (b !== null) return tracked;
        const untracked = yield* untrackedIn(dir);
        const rendered = untracked.slice(0, UNTRACKED_RENDER_LIMIT);
        const elided = untracked.length - rendered.length;
        const additions = yield* Effect.forEach(rendered, (file) =>
          git(
            ["diff", "--no-index", "--numstat", "--", "/dev/null", file],
            dir,
            undefined,
            [1],
          ).pipe(
            Effect.map((line) => {
              const [added = "0"] = line.split("\t");
              return {
                path: file,
                additions: added === "-" ? 0 : Number(added),
                deletions: 0,
              };
            }),
          ),
        );
        // The elided tail still COUNTS — an honest row instead of silence.
        return elided > 0
          ? [
              ...tracked,
              ...additions,
              {
                path: `… ${elided} more untracked files (not rendered)`,
                additions: 0,
                deletions: 0,
              },
            ]
          : [...tracked, ...additions];
      });

      const headSha = Effect.fn("Store.headSha")(function* (dir: string) {
        const head = yield* git(["rev-parse", "HEAD"], dir);
        return sha(head);
      });

      // `_references/` cannot collide with a project dir: adopted names go
      // through the API's name check, which rejects a leading underscore.
      const cloneReference = Effect.fn("Store.cloneReference")(function* (
        name: string,
        source: string,
        ref: string | null,
        remoteEnv: Record<string, string>,
      ) {
        const referencesRoot = path.join(config.root, "_references");
        const clonePath = path.join(referencesRoot, name);
        const attempt = Effect.gen(function* () {
          yield* Effect.sync(() => fs.mkdirSync(referencesRoot, { recursive: true }));
          yield* git(
            [
              "clone",
              "--depth",
              "1",
              ...(ref === null ? [] : ["--branch", ref]),
              source,
              clonePath,
            ],
            referencesRoot,
            remoteEnv,
          );
          const head = yield* git(["rev-parse", "HEAD"], clonePath);
          return { path: clonePath, headSha: sha(head) };
        });
        return yield* attempt.pipe(
          Effect.catch((cause) => Effect.fail(new ReferenceCloneError({ name, source, cause }))),
        );
      });

      const refreshReference = Effect.fn("Store.refreshReference")(function* (
        clonePath: string,
        ref: string | null,
        remoteEnv: Record<string, string>,
      ) {
        // No pin = follow whatever branch the clone is on. FETCH_HEAD + hard
        // reset handles branches and tags uniformly, force-pushes included —
        // a reference clone has no local work to protect.
        const target = ref ?? (yield* git(["symbolic-ref", "--short", "HEAD"], clonePath));
        yield* git(["fetch", "--depth", "1", "origin", target], clonePath, remoteEnv);
        yield* git(["reset", "--hard", "FETCH_HEAD"], clonePath);
        const head = yield* git(["rev-parse", "HEAD"], clonePath);
        return { path: clonePath, headSha: sha(head) };
      });

      const removeReference = Effect.fn("Store.removeReference")(function* (clonePath: string) {
        yield* Effect.sync(() => fs.rmSync(clonePath, { recursive: true, force: true }));
      });

      return {
        cloneReference,
        refreshReference,
        removeReference,
        adopt,
        createWorktree,
        resetWorktree,
        removeWorktree,
        removeWorktreeForce,
        removeProjectStore,
        checkpoint,
        diffRange,
        diffWorktree,
        changedFiles,
        headSha,
      };
    }),
  );
}

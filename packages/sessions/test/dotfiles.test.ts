import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import { resolveDotfilesArchives } from "../src/dotfiles.ts";

const tmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

const extract = (base64: string): string => {
  const dir = tmp("mend-dotfiles-extract-");
  const archive = path.join(dir, "a.tar.gz");
  fs.writeFileSync(archive, Buffer.from(base64, "base64"));
  fs.mkdirSync(path.join(dir, "out"));
  execFileSync("tar", ["-xzf", archive, "-C", path.join(dir, "out")]);
  return path.join(dir, "out");
};

describe("resolveDotfilesArchives", () => {
  it("resolves nothing configured to no archives", async () => {
    const archives = await Effect.runPromise(
      resolveDotfilesArchives({ repository: null, snapshot: null }),
    );
    expect(archives).toEqual([]);
  });

  it("wraps a store snapshot as a copy-manager archive after the repo", async () => {
    const origin = tmp("mend-dotfiles-origin-");
    execFileSync("git", ["init", "--initial-branch", "trunk"], { cwd: origin });
    fs.writeFileSync(path.join(origin, ".vimrc"), "set nocompatible\n");
    execFileSync("git", ["add", "."], { cwd: origin });
    execFileSync("git", ["commit", "-m", "init"], {
      cwd: origin,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    });

    const snapshotData = Buffer.from("snapshot-tarball").toString("base64");
    const archives = await Effect.runPromise(
      resolveDotfilesArchives({
        // A non-"main" default branch: the ref-less clone must take the remote's default.
        repository: { url: origin, ref: null, manager: "auto", bootstrap: true },
        snapshot: { sha: "abc123", data: snapshotData },
      }),
    );
    expect(archives).toHaveLength(2);
    expect(archives[0]?.manager).toBe("auto");
    expect(archives[0]?.bootstrap).toBe(true);
    const out = extract(archives[0]?.data ?? "");
    expect(fs.readFileSync(path.join(out, ".vimrc"), "utf8")).toBe("set nocompatible\n");
    expect(fs.existsSync(path.join(out, ".git"))).toBe(false);
    // The snapshot rides untouched — the store already packed it — with copy semantics.
    expect(archives[1]).toEqual({ data: snapshotData, manager: "copy", bootstrap: false });
  });

  it("fails readable when the repo cannot be cloned", async () => {
    const result = await Effect.runPromise(
      resolveDotfilesArchives({
        repository: {
          url: path.join(os.tmpdir(), "mend-dotfiles-does-not-exist"),
          ref: null,
          manager: "auto",
          bootstrap: true,
        },
        snapshot: null,
      }).pipe(Effect.result),
    );
    expect(Result.isFailure(result)).toBe(true);
    expect(String(result)).toMatch(/dotfiles clone/);
  });
});

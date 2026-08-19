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
        repository: {
          url: origin,
          ref: null,
          subdirectory: null,
          manager: "auto",
          bootstrap: true,
        },
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

  it("re-roots the archive at the configured subdirectory", async () => {
    const origin = tmp("mend-dotfiles-subdir-origin-");
    execFileSync("git", ["init", "--initial-branch", "trunk"], { cwd: origin });
    // The common shape: a home mirror in a subfolder, surrounded by repo clutter.
    fs.mkdirSync(path.join(origin, "dots", ".config", "zsh"), { recursive: true });
    fs.writeFileSync(path.join(origin, "dots", ".zshenv"), "export ZDOTDIR=~/.config/zsh\n");
    fs.writeFileSync(path.join(origin, "dots", ".config", "zsh", ".zshrc"), "setopt AUTOCD\n");
    fs.writeFileSync(path.join(origin, "README.md"), "not a dotfile\n");
    fs.writeFileSync(path.join(origin, "install.sh"), "#!/bin/sh\n");
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

    const archives = await Effect.runPromise(
      resolveDotfilesArchives({
        repository: {
          url: origin,
          ref: null,
          subdirectory: "dots",
          manager: "auto",
          bootstrap: true,
        },
        snapshot: null,
      }),
    );
    const out = extract(archives[0]?.data ?? "");
    // The subtree's CONTENTS are the archive root — ready to land at ~.
    expect(fs.readFileSync(path.join(out, ".zshenv"), "utf8")).toBe(
      "export ZDOTDIR=~/.config/zsh\n",
    );
    expect(fs.readFileSync(path.join(out, ".config", "zsh", ".zshrc"), "utf8")).toBe(
      "setopt AUTOCD\n",
    );
    // Root clutter stays behind — including the desktop-oriented bootstrap.
    expect(fs.existsSync(path.join(out, "README.md"))).toBe(false);
    expect(fs.existsSync(path.join(out, "install.sh"))).toBe(false);
    expect(fs.existsSync(path.join(out, "dots"))).toBe(false);
  });

  it("fails readable when the subdirectory does not exist in the repo", async () => {
    const origin = tmp("mend-dotfiles-badsubdir-origin-");
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

    const result = await Effect.runPromise(
      resolveDotfilesArchives({
        repository: {
          url: origin,
          ref: null,
          subdirectory: "does-not-exist",
          manager: "auto",
          bootstrap: true,
        },
        snapshot: null,
      }).pipe(Effect.result),
    );
    expect(Result.isFailure(result)).toBe(true);
    expect(String(result)).toMatch(/git archive/);
    expect(String(result)).toMatch(/does-not-exist/);
  });

  it("fails readable when the repo cannot be cloned", async () => {
    const result = await Effect.runPromise(
      resolveDotfilesArchives({
        repository: {
          url: path.join(os.tmpdir(), "mend-dotfiles-does-not-exist"),
          ref: null,
          subdirectory: null,
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

import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { defaultSettings, DotfilesRepository, MendSettings } from "../src/settings.ts";

describe("MendSettings workspace image profile", () => {
  it("defaults new installs to the standard Arch developer image", () => {
    expect(defaultSettings.workspaceImage).toEqual({
      mode: "family",
      os: "arch",
      packages: [
        "pnpm",
        "python",
        "uv",
        "mise",
        "github-cli",
        "lazygit",
        "bat",
        "curl",
        "jq",
        "ripgrep",
        "fd",
        "fzf",
      ],
      shell: "bash",
      services: { docker: true },
    });
  });

  it("adds the image profile when decoding settings written before it existed", () => {
    const decoded = Schema.decodeUnknownSync(MendSettings)({
      prMode: "draft-immediately",
      concurrency: 1,
      autoTour: true,
      autoSuggest: true,
    });

    expect(decoded.workspaceImage).toEqual({
      mode: "family",
      os: "arch",
      packages: [
        "pnpm",
        "python",
        "uv",
        "mise",
        "github-cli",
        "lazygit",
        "bat",
        "curl",
        "jq",
        "ripgrep",
        "fd",
        "fzf",
      ],
      shell: "bash",
      services: { docker: true },
    });
  });

  it("defaults autoName on when decoding settings written before it existed", () => {
    const decoded = Schema.decodeUnknownSync(MendSettings)({
      prMode: "draft-immediately",
      concurrency: 1,
      autoTour: true,
      autoSuggest: true,
    });
    expect(decoded.autoName).toBe(true);

    const explicit = Schema.decodeUnknownSync(MendSettings)({
      prMode: "draft-immediately",
      concurrency: 1,
      autoTour: true,
      autoSuggest: true,
      autoName: false,
    });
    expect(explicit.autoName).toBe(false);
  });

  it("decodes pre-shell family images to the platform's bash default", () => {
    const decoded = Schema.decodeUnknownSync(MendSettings)({
      prMode: "draft-immediately",
      concurrency: 1,
      autoTour: true,
      autoSuggest: true,
      workspaceImage: {
        mode: "family",
        os: "nix",
        packages: ["pnpm"],
        services: { docker: false },
      },
    });
    expect(decoded.workspaceImage).toEqual({
      mode: "family",
      os: "nix",
      packages: ["pnpm"],
      shell: "bash",
      services: { docker: false },
    });
  });

  it("fills dotfiles repository knobs when only a url was stored", () => {
    const decoded = Schema.decodeUnknownSync(DotfilesRepository)({
      url: "git@github.com:acme/dotfiles.git",
    });
    expect(decoded).toEqual({
      url: "git@github.com:acme/dotfiles.git",
      ref: null,
      subdirectory: null,
      manager: "auto",
      bootstrap: true,
    });
  });

  it("accepts a repo-relative subdirectory and rejects escapes", () => {
    const decode = Schema.decodeUnknownSync(DotfilesRepository);
    const base = { url: "git@github.com:acme/dotfiles.git" };
    expect(decode({ ...base, subdirectory: "dots" }).subdirectory).toBe("dots");
    expect(decode({ ...base, subdirectory: "home/dots" }).subdirectory).toBe("home/dots");
    // The value lands in `git archive HEAD:<subdirectory>` — nothing that escapes the repo.
    for (const bad of ["", "/dots", "dots/", "../dots", "dots/../..", "a//b", ".", "d:o"]) {
      expect(() => decode({ ...base, subdirectory: bad })).toThrow();
    }
  });
});

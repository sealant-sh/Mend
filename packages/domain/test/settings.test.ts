import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { defaultSettings, MendSettings } from "../src/settings.ts";

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
      services: { docker: true },
    });
  });
});

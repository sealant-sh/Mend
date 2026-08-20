import { describe, expect, it } from "vitest";

import { parseLaunchArgs } from "./shared.ts";

describe("parseLaunchArgs", () => {
  it("parses a bare invocation to all-null", () => {
    expect(parseLaunchArgs([])).toEqual({
      project: null,
      prompt: null,
      model: null,
      effort: null,
      base: null,
      ask: false,
      fast: false,
      custom: [],
      error: null,
    });
  });

  it("takes the first positional as the prompt and every flag by name", () => {
    const parsed = parseLaunchArgs([
      "fix the auth test",
      "--model",
      "sonnet",
      "--effort",
      "high",
      "--base",
      "release/1.2",
      "--ask",
      "--fast",
      "--project",
      "mend",
    ]);
    expect(parsed).toEqual({
      project: "mend",
      prompt: "fix the auth test",
      model: "sonnet",
      effort: "high",
      base: "release/1.2",
      ask: true,
      fast: true,
      custom: [],
      error: null,
    });
  });

  it("rejects a second positional so a forgotten quote fails loudly", () => {
    expect(parseLaunchArgs(["fix", "the auth test"]).error).toContain("quote it");
  });

  it("rejects an unknown flag and a prompt starting with a dash", () => {
    expect(parseLaunchArgs(["--nope"]).error).toContain("unknown flag");
    expect(parseLaunchArgs(["-rf everything"]).error).toContain("unknown flag");
  });

  it("rejects a flag without a value and a bad effort level", () => {
    expect(parseLaunchArgs(["--model"]).error).toContain("needs a value");
    expect(parseLaunchArgs(["--effort", "extreme"]).error).toContain("--effort must be one of");
  });

  it("keeps everything after -- verbatim for mend run", () => {
    const parsed = parseLaunchArgs(["--project", "mend", "--", "npm", "test", "--force"]);
    expect(parsed.project).toBe("mend");
    expect(parsed.custom).toEqual(["npm", "test", "--force"]);
    expect(parsed.error).toBeNull();
  });
});

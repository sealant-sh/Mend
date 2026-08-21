import { describe, expect, it } from "vitest";

import { classifyGhError, GhError, parseGithubRepo } from "./github.ts";

describe("parseGithubRepo", () => {
  it("reads owner/name from every GitHub origin shape", () => {
    expect(parseGithubRepo("https://github.com/sealant-sh/mend")).toBe("sealant-sh/mend");
    expect(parseGithubRepo("https://github.com/sealant-sh/mend.git")).toBe("sealant-sh/mend");
    expect(parseGithubRepo("https://www.github.com/sealant-sh/mend/")).toBe("sealant-sh/mend");
    expect(parseGithubRepo("git@github.com:sealant-sh/mend.git")).toBe("sealant-sh/mend");
    expect(parseGithubRepo("ssh://git@github.com/sealant-sh/mend.git")).toBe("sealant-sh/mend");
    expect(parseGithubRepo("github.com:sealant-sh/mend")).toBe("sealant-sh/mend");
  });

  it("answers null for anything that is not GitHub", () => {
    expect(parseGithubRepo(null)).toBeNull();
    expect(parseGithubRepo("https://gitlab.com/sealant-sh/mend.git")).toBeNull();
    expect(parseGithubRepo("/home/yiannis/Developer/mend")).toBeNull();
    expect(parseGithubRepo("git@github.com:sealant-sh")).toBeNull();
    expect(parseGithubRepo("https://github.com/")).toBeNull();
  });
});

const error = (stderr: string, exitCode: number | null = 1) =>
  new GhError({ args: ["pr", "list"], exitCode, stderr });

describe("classifyGhError", () => {
  it("tells a missing gh from a signed-out one from a rate limit", () => {
    expect(classifyGhError(error("spawn gh ENOENT", null))).toBe("gh-missing");
    expect(
      classifyGhError(error("To get started with GitHub CLI, please run:  gh auth login")),
    ).toBe("gh-signed-out");
    expect(classifyGhError(error("HTTP 403: API rate limit exceeded for user ID 1"))).toBe(
      "rate-limited",
    );
    expect(classifyGhError(error("GraphQL: Could not resolve to a Repository"))).toBe("error");
  });
});

import { describe, expect, it } from "vitest";

import { RepositoryCloneUrl, repositoryCloneUrlIssue } from "../src/workbench/project.ts";

const accepted = [
  "https://github.com/sealant-sh/Mend",
  "http://git.example.test/team/repo.git",
  "ssh://git@git.example.test/team/repo.git",
  "git@git.example.test:team/repo.git",
  "git://git.example.test/team/repo.git",
] as const;

const rejected = [
  "file:///Users/me/code/repo",
  "/Users/me/code/repo",
  "../repo",
  "./repo",
  "repo",
  "C:\\Users\\me\\repo",
  "https://github.com",
] as const;

describe("RepositoryCloneUrl", () => {
  it.each(accepted)("accepts %s", (value) => {
    expect(repositoryCloneUrlIssue(value)).toBeNull();
    expect(() => RepositoryCloneUrl.make(value)).not.toThrow();
  });

  it.each(rejected)("rejects %s", (value) => {
    expect(repositoryCloneUrlIssue(value)).toContain("Local paths and file:// URLs");
    expect(() => RepositoryCloneUrl.make(value)).toThrow();
  });
});

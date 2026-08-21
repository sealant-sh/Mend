import { describe, expect, it } from "vitest";

import { ancestorsOf, buildFileTree } from "./files.ts";

describe("buildFileTree", () => {
  it("nests a flat listing, directories before files at every level", () => {
    const tree = buildFileTree(["README.md", "apps/web/a.ts", "apps/web/b.ts", "apps/z.ts"]);
    expect(tree.children.map((node) => `${node.kind}:${node.name}`)).toEqual([
      "dir:apps",
      "file:README.md",
    ]);
    const apps = tree.children[0];
    expect(apps?.fileCount).toBe(3);
    expect(apps?.children.map((node) => node.path)).toEqual(["apps/web", "apps/z.ts"]);
    expect(apps?.children[0]?.children.map((node) => node.path)).toEqual([
      "apps/web/a.ts",
      "apps/web/b.ts",
    ]);
  });

  it("tolerates empty and slash-padded entries", () => {
    const tree = buildFileTree(["", "/x", "a//b"]);
    expect(tree.children.map((node) => node.path)).toEqual(["a", "x"]);
    expect(tree.fileCount).toBe(2);
  });
});

describe("ancestorsOf", () => {
  it("lists every containing directory, shallowest first", () => {
    expect(ancestorsOf("apps/web/src/a.ts")).toEqual(["apps", "apps/web", "apps/web/src"]);
    expect(ancestorsOf("README.md")).toEqual([]);
  });
});

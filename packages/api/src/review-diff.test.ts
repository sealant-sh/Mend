import { describe, expect, it } from "vitest";

import { digestReviewPatch, lineAnchorExists, parseReviewDiff } from "./review-diff.ts";

const patch = `diff --git a/old.ts b/new.ts
similarity index 60%
rename from old.ts
rename to new.ts
index 1111111..2222222 100644
--- a/old.ts
+++ b/new.ts
@@ -1,3 +1,3 @@
 keep
-old
+new
 tail
diff --git a/gone.ts b/gone.ts
deleted file mode 100644
index 3333333..0000000
--- a/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-one
-two`;

describe("immutable Review diff", () => {
  it("builds structured files and stable hunk hashes from exact patch bytes", () => {
    const files = parseReviewDiff(patch, [
      {
        oldPath: "old.ts",
        newPath: "new.ts",
        status: "renamed",
        additions: 1,
        deletions: 1,
        binary: false,
      },
      {
        oldPath: "gone.ts",
        newPath: null,
        status: "deleted",
        additions: 0,
        deletions: 2,
        binary: false,
      },
    ]);

    expect(digestReviewPatch(patch)).toMatch(/^[0-9a-f]{64}$/);
    expect(files).toHaveLength(2);
    expect(files[0]?.hunks[0]).toMatchObject({
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 3,
    });
    expect(files[1]?.status).toBe("deleted");
  });

  it("accepts only ranges bound to the matching file, side, and hunk context", () => {
    const files = parseReviewDiff(patch, [
      {
        oldPath: "old.ts",
        newPath: "new.ts",
        status: "renamed",
        additions: 1,
        deletions: 1,
        binary: false,
      },
      {
        oldPath: "gone.ts",
        newPath: null,
        status: "deleted",
        additions: 0,
        deletions: 2,
        binary: false,
      },
    ]);
    const contextHash = files[0]?.hunks[0]?.contextHash ?? "";
    const target = {
      oldPath: "old.ts",
      newPath: "new.ts",
      side: "old" as const,
      startLine: 2,
      endLine: 2,
      hunkContextHash: contextHash,
    };

    expect(lineAnchorExists(files, target)).toBe(true);
    expect(lineAnchorExists(files, { ...target, side: "new", startLine: 8 })).toBe(false);
    expect(lineAnchorExists(files, { ...target, hunkContextHash: "stale" })).toBe(false);
  });
});

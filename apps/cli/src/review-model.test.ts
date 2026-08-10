import { describe, expect, it } from "vitest";

import { assembleReviewInstruction, buildReviewFiles } from "./review-model.ts";

const PATCH = `diff --git a/src/greet.ts b/src/greet.ts
index 1111111..2222222 100644
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1,3 +1,4 @@
 export const greet = (name: string) => {
-  return \`Hi \${name}\`;
+  const greeting = \`Hello \${name}\`;
+  return greeting;
 };
diff --git a/README.md b/README.md
index 3333333..4444444 100644
--- a/README.md
+++ b/README.md
@@ -10 +10 @@ Usage
-Run it.
+Run \`mend review\`.
`;

describe("buildReviewFiles", () => {
  it("turns a multi-file git patch into navigable new-side review anchors", () => {
    const files = buildReviewFiles(PATCH, [
      { path: "src/greet.ts", additions: 2, deletions: 1 },
      { path: "README.md", additions: 1, deletions: 1 },
    ]);

    expect(files.map((file) => file.path)).toEqual(["src/greet.ts", "README.md"]);
    expect(files[0]).toMatchObject({
      additions: 2,
      deletions: 1,
      filetype: "typescript",
      unifiedRows: 5,
      splitRows: 4,
    });
    expect(files[0]?.hunks).toEqual([
      { index: 0, header: "@@ -1,3 +1,4 @@", unifiedRow: 0, splitRow: 0 },
    ]);
    expect(
      files[0]?.lines.map(({ kind, oldLine, newLine, unifiedRow, splitRow, commentable }) => ({
        kind,
        oldLine,
        newLine,
        unifiedRow,
        splitRow,
        commentable,
      })),
    ).toEqual([
      {
        kind: "context",
        oldLine: 1,
        newLine: 1,
        unifiedRow: 0,
        splitRow: 0,
        commentable: true,
      },
      {
        kind: "deletion",
        oldLine: 2,
        newLine: null,
        unifiedRow: 1,
        splitRow: 1,
        commentable: false,
      },
      {
        kind: "addition",
        oldLine: null,
        newLine: 2,
        unifiedRow: 2,
        splitRow: 1,
        commentable: true,
      },
      {
        kind: "addition",
        oldLine: null,
        newLine: 3,
        unifiedRow: 3,
        splitRow: 2,
        commentable: true,
      },
      {
        kind: "context",
        oldLine: 3,
        newLine: 4,
        unifiedRow: 4,
        splitRow: 3,
        commentable: true,
      },
    ]);
    expect(files[0]?.patch.startsWith("diff --git a/src/greet.ts b/src/greet.ts\n")).toBe(true);
  });
});

describe("assembleReviewInstruction", () => {
  it("preserves file ranges and concrete suggestions in the editable session follow-up", () => {
    const instruction = assembleReviewInstruction({ branch: "mend/session/bright-otter" }, [
      {
        file: "src/greet.ts",
        line: 2,
        endLine: 3,
        body: "Keep the existing greeting contract.",
        suggestion: "  return `Hi ${name}`;",
      },
      {
        file: null,
        line: null,
        endLine: null,
        body: "Add the observed check to the handoff.",
        suggestion: null,
      },
    ]);

    expect(instruction).toContain("The branch mend/session/bright-otter is already checked out");
    expect(instruction).toContain(
      "1. src/greet.ts:2-3 — Keep the existing greeting contract.\n   Proposed replacement:\n     return `Hi ${name}`;",
    );
    expect(instruction).toContain(
      "2. the change as a whole — Add the observed check to the handoff.",
    );
    expect(instruction).toContain("Report honestly what you changed and what you did not");
  });
});

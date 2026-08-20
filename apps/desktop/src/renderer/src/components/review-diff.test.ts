import { describe, expect, it } from "vitest";

import { parseDesktopReviewPatch } from "./review-diff";

const typeChangePatch = `diff --git a/t.txt b/t.txt
deleted file mode 100644
index 62e0af5..0000000
--- a/t.txt
+++ /dev/null
@@ -1 +0,0 @@
-target
diff --git a/t.txt b/t.txt
new file mode 120000
index 0000000..1de5659
--- /dev/null
+++ b/t.txt
@@ -0,0 +1 @@
+k.txt
\\ No newline at end of file`;

describe("desktop Review patch rendering", () => {
  it("keeps both sections of a file type change", () => {
    const files = parseDesktopReviewPatch(typeChangePatch);

    expect(files).toHaveLength(2);
    expect(files[0]?.name).toBe("t.txt");
    expect(files[1]?.name).toBe("t.txt");
  });
});

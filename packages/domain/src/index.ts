/**
 * @mend/domain — the product's objects and their cardinality.
 *
 * ```
 * issue  1 ── 0..n  runs       initial · follow-up · re-verification
 * run    1 ── 1     recording  the run audit is the view over one run
 * issue  1 ── 0..1  change     one branch per issue → 0..1 PR carrying it
 * change 1 ── 1     brief      living — recompiled after every run
 * ```
 *
 * Runs are many; the change and its PR are one; the brief is one, and current.
 */
export * from "./brief-comment.ts";
export * from "./brief.ts";
export * from "./change.ts";
export * from "./evidence.ts";
export * from "./ids.ts";
export * from "./inference.ts";
export * from "./issue.ts";
export * from "./review-question.ts";
export * from "./run.ts";
export * from "./settings.ts";

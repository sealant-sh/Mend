/**
 * @mend/domain/workbench — the agent-workbench object model
 * (MEND-AGENT-WORKBENCH-PLAN.md §5).
 *
 * ```
 * machine  1 ── 0..n  projects    a repository adopted into the central store
 * project  1 ── 0..n  sessions    one logical agent conversation, one worktree each
 * session  1 ── 0..n  runs        Sealant execution records, one sequence space each
 * session  1 ── 0..n  processes   PTYs in the current workspace: agent, shells, Services
 * session  1 ── 1     change      worktree vs base — the reviewable object
 * session  1 ── 0..n  checkpoints hidden git ref + exact record pointer; two = a slice
 * session  1 ── 0..1  snapshot    immutable context manifest
 * change   1 ── 0..n  comments    reviewer's and Mend's, same pipeline
 * ```
 *
 * Lives on a subpath while the queue-era model retires; promotes to the root
 * barrel when `issue.ts` and friends go (docs/M0-INVENTORY.md).
 */
export * from "./change.ts";
export * from "./checkpoint.ts";
export * from "./context.ts";
export * from "./follow-up.ts";
export * from "./mount.ts";
export * from "./pass.ts";
export * from "./project.ts";
export * from "./reference.ts";
export * from "./review-comment.ts";
export * from "./service-recipe.ts";
export * from "./session.ts";
export * from "./session-process.ts";
export * from "./session-run.ts";
export * from "./tour.ts";

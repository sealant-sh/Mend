import { describe, expect, it, vi } from "vitest";

import { commentRange, deliverReview, reviewTargetForSession } from "./review-workflow.ts";

const input = {
  reviewSliceId: "slice-1",
  checkpointAId: "checkpoint-a",
  checkpointBId: "checkpoint-b",
  diffDigest: "digest",
  commentIds: ["comment-1", "comment-2"],
  instruction: "Please fix both comments.",
  idempotencyKey: "delivery-1",
};

describe("terminal review workflow", () => {
  it("opens the highlighted reviewable session and normalizes an inline range", () => {
    const session = { id: "session-1", harness: "codex" };

    expect(reviewTargetForSession(session, { changeId: "change-1" }, "mend")).toEqual({
      session,
      changeId: "change-1",
      projectName: "mend",
    });
    expect(reviewTargetForSession(session, { changeId: null }, "mend")).toBeNull();
    expect(commentRange(14, 9)).toEqual({ line: 9, endLine: 14 });
    expect(commentRange(null, 9)).toEqual({ line: 9, endLine: null });
  });

  it("delivers through one idempotent server-owned operation", async () => {
    const api = vi.fn(async () => ({}));

    await deliverReview(api, "session-1", input);

    expect(api).toHaveBeenCalledOnce();
    expect(api).toHaveBeenCalledWith("POST", "/sessions/session-1/follow-up/deliver", input);
  });
});

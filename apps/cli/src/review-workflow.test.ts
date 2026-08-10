import { describe, expect, it, vi } from "vitest";

import { commentRange, deliverReview, reviewTargetForSession } from "./review-workflow.ts";

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

  it("delivers an edited review and relaunches the same session", async () => {
    const api = vi.fn(async () => ({}));

    await deliverReview(api, { id: "session-1", harness: "codex" }, "Please fix both comments.");

    expect(api).toHaveBeenNthCalledWith(1, "POST", "/sessions/session-1/follow-up/deliver", {});
    expect(api).toHaveBeenNthCalledWith(2, "POST", "/sessions/session-1/launch", {
      argv: ["codex", "Please fix both comments."],
    });
  });
});

import { describe, expect, it } from "vitest";

import {
  HARNESS_STATE,
  distillOpeningPrompt,
  extractTranscript,
  nativeResumeArgv,
} from "./harness-state.ts";

const claudeJsonl = [
  JSON.stringify({ type: "summary", summary: "ignored" }),
  JSON.stringify({
    type: "user",
    isMeta: true,
    message: { role: "user", content: "meta line — ignored" },
  }),
  JSON.stringify({ type: "user", message: { role: "user", content: "add a health endpoint" } }),
  JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "Added /health returning ok." },
        { type: "tool_use", id: "t1", name: "Edit", input: {} },
      ],
    },
  }),
  JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", content: "ok" }] },
  }),
  "not json",
].join("\n");

const codexJsonl = [
  JSON.stringify({ type: "session_meta", payload: { id: "abc" } }),
  JSON.stringify({
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: "" },
        { type: "text", text: "rename the flag" },
      ],
    },
  }),
  JSON.stringify({
    type: "response_item",
    payload: { type: "reasoning", summary: [] },
  }),
  JSON.stringify({
    type: "response_item",
    payload: { type: "message", role: "assistant", content: [{ type: "text", text: "Renamed." }] },
  }),
].join("\n");

describe("transcript adapters", () => {
  it("normalizes a claude session jsonl to turns, skipping meta/tool noise", () => {
    const turns = extractTranscript("claude", claudeJsonl);
    expect(turns).toEqual([
      { role: "user", text: "add a health endpoint" },
      { role: "assistant", text: "Added /health returning ok." },
    ]);
  });

  it("normalizes a codex rollout jsonl to turns", () => {
    const turns = extractTranscript("codex", codexJsonl);
    expect(turns).toEqual([
      { role: "user", text: "rename the flag" },
      { role: "assistant", text: "Renamed." },
    ]);
  });

  it("unknown harness yields no turns", () => {
    expect(extractTranscript("run", claudeJsonl)).toEqual([]);
  });

  it("distills a cross-harness opening prompt with the source named", () => {
    const prompt = distillOpeningPrompt("claude", extractTranscript("claude", claudeJsonl));
    expect(prompt).toContain("previously driven by claude");
    expect(prompt).toContain("add a health endpoint");
    expect(prompt).toContain("Continue from where the conversation left off.");
  });

  it("derives provider session ids from native transcript paths", () => {
    expect(
      HARNESS_STATE["claude"]?.providerSessionId(
        "/root/.claude/projects/-workspace-repo/0f9a2c3d-1111-2222-3333-444455556666.jsonl",
      ),
    ).toBe("0f9a2c3d-1111-2222-3333-444455556666");
    expect(
      HARNESS_STATE["codex"]?.providerSessionId(
        "/root/.codex/sessions/2026/07/25/rollout-2026-07-25T22-11-00-0f9a2c3d-1111-2222-3333-444455556666.jsonl",
      ),
    ).toBe("0f9a2c3d-1111-2222-3333-444455556666");
  });

  it("resumes a saved Codex session by provider id", () => {
    expect(nativeResumeArgv("codex", "codex-session-id", ["codex"])).toEqual([
      "codex",
      "resume",
      "codex-session-id",
    ]);
    expect(nativeResumeArgv("codex", "codex-session-id", ["codex", "continue the review"])).toEqual(
      ["codex", "resume", "codex-session-id", "continue the review"],
    );
  });

  it("does not wrap an argv that already resumes natively", () => {
    expect(
      nativeResumeArgv("codex", "saved-session-id", ["codex", "resume", "requested-session-id"]),
    ).toEqual(["codex", "resume", "requested-session-id"]);
    expect(
      nativeResumeArgv("claude", "saved-session-id", [
        "claude",
        "--resume",
        "requested-session-id",
      ]),
    ).toEqual(["claude", "--resume", "requested-session-id"]);
  });

  it("leaves launches without resumable native state unchanged", () => {
    expect(nativeResumeArgv("codex", null, ["codex"])).toEqual(["codex"]);
    expect(nativeResumeArgv("opencode", "session-id", ["opencode"])).toEqual(["opencode"]);
  });
});

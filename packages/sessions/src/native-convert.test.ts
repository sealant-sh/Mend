import { describe, expect, it } from "vitest";

import { convertNativeSession } from "./native-convert.ts";

const claudeJsonl = [
  JSON.stringify({ type: "user", message: { role: "user", content: "add a health endpoint" } }),
  JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "Adding it now." },
        { type: "tool_use", id: "t1", name: "Bash", input: { command: "pnpm test" } },
      ],
    },
  }),
  JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "1 passed" }] },
      ],
    },
  }),
  JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: "Done — tests pass." }] },
  }),
].join("\n");

describe("native session conversion", () => {
  it("claude → codex: a valid rollout with meta, messages, and a real shell item", () => {
    const converted = convertNativeSession("claude", "codex", claudeJsonl, {
      cwd: "/workspace/repo",
      now: "2026-07-26T00:00:00.000Z",
    });
    expect(converted).not.toBeNull();
    const file = converted?.files[0];
    expect(file?.path).toMatch(/^\.codex\/sessions\/2026\/07\/26\/rollout-.*\.jsonl$/);
    const lines = (file?.content ?? "")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines[0].type).toBe("session_meta");
    expect(lines[0].payload.id).toBe(converted?.providerSessionId);
    const kinds = lines.map((line) => `${line.type}/${line.payload?.type ?? ""}`);
    expect(kinds).toContain("response_item/message");
    expect(kinds).toContain("response_item/function_call");
    expect(kinds).toContain("response_item/function_call_output");
    const call = lines.find((line) => line.payload?.type === "function_call");
    expect(call.payload.name).toBe("exec_command");
    expect(JSON.parse(call.payload.arguments).cmd).toBe("pnpm test");
    expect(converted?.resumeArgv[1]).toBe("resume");
  });

  it("round-trips codex → claude with text and shell fidelity", () => {
    const toCodex = convertNativeSession("claude", "codex", claudeJsonl, {
      cwd: "/workspace/repo",
      now: "2026-07-26T00:00:00.000Z",
    });
    const back = convertNativeSession("codex", "claude", toCodex?.files[0]?.content ?? "", {
      cwd: "/workspace/repo",
      now: "2026-07-26T00:00:00.000Z",
    });
    expect(back).not.toBeNull();
    const content = back?.files[0]?.content ?? "";
    expect(content).toContain("add a health endpoint");
    expect(content).toContain("Done — tests pass.");
    expect(content).toContain('"name":"Bash"');
    expect(content).toContain("pnpm test");
    expect(back?.files[0]?.path).toMatch(/^\.claude\/projects\/-workspace-repo\/.*\.jsonl$/);
    expect(back?.resumeArgv[1]).toBe("--resume");
  });

  it("unsupported pairs return null (fallback to distilled prompt)", () => {
    expect(
      convertNativeSession("claude", "opencode", claudeJsonl, {
        cwd: "/workspace/repo",
        now: "2026-07-26T00:00:00.000Z",
      }),
    ).toBeNull();
  });
});

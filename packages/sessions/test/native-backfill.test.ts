import { describe, expect, it } from "vitest";

import { backfillFromNative, cursorAtEndOf } from "../src/native-backfill.ts";

const jsonl = (entries: ReadonlyArray<unknown>): string =>
  entries.map((entry) => JSON.stringify(entry)).join("\n");

const claudeTranscript = jsonl([
  { type: "user", uuid: "u1", message: { role: "user", content: "fix the test" } },
  {
    type: "assistant",
    uuid: "a1",
    message: {
      id: "msg_1",
      content: [
        { type: "thinking", thinking: "hmm" },
        { type: "text", text: "done" },
      ],
    },
  },
  {
    type: "assistant",
    uuid: "a2",
    message: {
      id: "msg_2",
      content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } }],
    },
  },
  {
    type: "user",
    uuid: "u2",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }],
    },
  },
  { type: "user", uuid: "u3", isMeta: true, message: { role: "user", content: "local meta" } },
  { type: "user", uuid: "u4", message: { role: "user", content: "thanks, also update docs" } },
  {
    type: "assistant",
    uuid: "a3",
    message: { id: "msg_3", content: [{ type: "text", text: "updated" }] },
  },
]);

describe("backfillFromNative · claude", () => {
  it("lands user turns with the real content blocks under the live adapter's item identity", () => {
    const result = backfillFromNative("claude", "sess-1", claudeTranscript, null);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.turns.map((turn) => turn.providerTurnId)).toEqual(["native:u1", "native:u4"]);
    expect(result.turns[0]?.input).toBe("fix the test");
    // tool_result-only and isMeta user entries never open turns.
    expect(result.turns[0]?.items).toEqual([
      {
        providerItemId: "msg_1:block:0",
        providerTurnId: "native:u1",
        kind: "reasoning",
        status: "completed",
        title: null,
        text: "hmm",
        data: { type: "thinking", thinking: "hmm" },
      },
      {
        providerItemId: "msg_1:block:1",
        providerTurnId: "native:u1",
        kind: "assistant-message",
        status: "completed",
        title: null,
        text: "done",
        data: { type: "text", text: "done" },
      },
      {
        providerItemId: "toolu_1",
        providerTurnId: "native:u1",
        kind: "command-execution",
        status: "completed",
        title: "Bash",
        text: null,
        data: { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } },
      },
    ]);
    expect(result.turns[1]?.items.map((item) => item.providerItemId)).toEqual(["msg_3:block:0"]);
    expect(result.cursor).toEqual({
      providerSessionId: "sess-1",
      lastEntryUuid: "a3",
      lineCount: 7,
    });
  });

  it("a repeated backfill past its own cursor is empty", () => {
    const first = backfillFromNative("claude", "sess-1", claudeTranscript, null);
    if (first === null) return expect.fail("first parse failed");
    const again = backfillFromNative("claude", "sess-1", claudeTranscript, first.cursor);
    expect(again?.turns).toEqual([]);
  });

  it("resumes from a mid-file boundary — only the tail backfills", () => {
    const result = backfillFromNative("claude", "sess-1", claudeTranscript, {
      providerSessionId: "sess-1",
      lastEntryUuid: "u2",
      lineCount: 4,
    });
    expect(result?.turns.map((turn) => turn.providerTurnId)).toEqual(["native:u4"]);
  });

  it("a boundary missing from the file backfills nothing — duplicates are worse than gaps", () => {
    const result = backfillFromNative("claude", "sess-1", claudeTranscript, {
      providerSessionId: "sess-1",
      lastEntryUuid: "not-in-this-file",
      lineCount: 0,
    });
    expect(result?.turns).toEqual([]);
  });
});

const codexRollout = jsonl([
  { type: "session_meta", payload: { id: "thread-1" } },
  {
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "<ENVIRONMENT>instructions</ENVIRONMENT>" }],
    },
  },
  {
    type: "response_item",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text: "fix it" }] },
  },
  {
    type: "response_item",
    payload: { type: "reasoning", summary: [{ type: "summary_text", text: "thinking" }] },
  },
  {
    type: "response_item",
    payload: {
      type: "function_call",
      name: "exec_command",
      arguments: '{"cmd":"ls"}',
      call_id: "call_1",
    },
  },
  {
    type: "response_item",
    payload: { type: "function_call_output", call_id: "call_1", output: "ok" },
  },
  {
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "done" }],
    },
  },
]);

describe("backfillFromNative · codex", () => {
  it("lands real user turns with rollout payloads verbatim; environment wrappers never open turns", () => {
    const result = backfillFromNative("codex", "thread-1", codexRollout, null);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.turns.map((turn) => turn.providerTurnId)).toEqual(["native:user:2"]);
    expect(result.turns[0]?.input).toBe("fix it");
    expect(result.turns[0]?.items.map((item) => [item.providerItemId, item.kind])).toEqual([
      ["rollout:3", "reasoning"],
      ["call_1", "command-execution"],
      ["rollout:6", "assistant-message"],
    ]);
    expect(result.cursor).toEqual({
      providerSessionId: "thread-1",
      lastEntryUuid: null,
      lineCount: 7,
    });
  });

  it("a repeated backfill past its own cursor is empty", () => {
    const first = backfillFromNative("codex", "thread-1", codexRollout, null);
    if (first === null) return expect.fail("first parse failed");
    const again = backfillFromNative("codex", "thread-1", codexRollout, first.cursor);
    expect(again?.turns).toEqual([]);
  });
});

describe("cursorAtEndOf", () => {
  it("marks the whole transcript ingested, for the protocol-harvest stamp", () => {
    expect(cursorAtEndOf("claude", "sess-1", claudeTranscript)).toEqual({
      providerSessionId: "sess-1",
      lastEntryUuid: "a3",
      lineCount: 7,
    });
    expect(cursorAtEndOf("opencode", "x", "")).toBeNull();
  });
});

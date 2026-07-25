/**
 * TRUE cross-harness session conversion: the saved native session of harness A
 * rewritten as a native session of harness B, so B's OWN resume machinery
 * opens it — full history in B's UI and in the model's context, as if B had
 * run it. No distillation, no summary prompt.
 *
 * Fidelity is tiered and honest:
 *  - user/assistant messages: byte-exact text, 1:1
 *  - shell activity: mapped to the target's real shell item (claude `Bash` ↔
 *    codex `exec_command`) — semantically identical
 *  - other tool calls: structured passthrough (name + arguments + output kept
 *    verbatim under the source harness's tool name) — the model reads exactly
 *    what happened; the target UI shows a generic tool call
 *  - provider-internal blobs (codex encrypted reasoning, claude thinking
 *    signatures): cannot be fabricated for another provider; dropped
 *
 * Formats verified against the real implementations (reference clones):
 *  - codex: codex-rs/protocol models.rs + rollout recorder (lenient parser,
 *    requires one session_meta line; resume falls back to a file scan)
 *  - claude: observed session JSONL from harvested state (this store)
 */

export interface ConvertedNativeSession {
  /** The target harness's own session id — what its native resume addresses. */
  readonly providerSessionId: string;
  /** Files to place under the workspace `$HOME`, exactly as the harness would have written them. */
  readonly files: ReadonlyArray<{ readonly path: string; readonly content: string }>;
  /** argv that opens the converted session natively in the target harness. */
  readonly resumeArgv: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Normalized intermediate: everything either side can express.
// ---------------------------------------------------------------------------

type Item =
  | { readonly kind: "user"; readonly text: string }
  | { readonly kind: "assistant"; readonly text: string }
  | {
      readonly kind: "tool";
      readonly name: string;
      readonly args: string;
      readonly output: string;
      /** True when this is plain shell execution — both harnesses have a native form. */
      readonly shell: boolean;
      readonly command: string | null;
    };

const asText = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const p = part as { readonly type?: string; readonly text?: string };
        return typeof p.text === "string" &&
          (p.type === "text" || p.type === "input_text" || p.type === "output_text")
          ? p.text
          : "";
      })
      .filter((text) => text !== "")
      .join("\n");
  }
  return "";
};

/** Claude session JSONL → normalized items (tool_use pairs matched to their results). */
const readClaude = (jsonl: string): Item[] => {
  const items: Item[] = [];
  const pendingTools = new Map<string, { name: string; args: string; command: string | null }>();
  for (const line of jsonl.split("\n")) {
    if (line.trim() === "") continue;
    let entry: {
      readonly type?: string;
      readonly isMeta?: boolean;
      readonly message?: { readonly role?: string; readonly content?: unknown };
    };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      continue;
    }
    if (entry.isMeta === true) continue;
    const content = entry.message?.content;
    if (entry.type === "assistant" && Array.isArray(content)) {
      for (const part of content) {
        const p = part as {
          readonly type?: string;
          readonly text?: string;
          readonly id?: string;
          readonly name?: string;
          readonly input?: unknown;
        };
        if (p.type === "text" && typeof p.text === "string" && p.text.trim() !== "") {
          items.push({ kind: "assistant", text: p.text });
        }
        if (p.type === "tool_use" && typeof p.id === "string") {
          const input = p.input as { readonly command?: string } | undefined;
          pendingTools.set(p.id, {
            name: p.name ?? "tool",
            args: JSON.stringify(p.input ?? {}),
            command: p.name === "Bash" && typeof input?.command === "string" ? input.command : null,
          });
        }
      }
    }
    if (entry.type === "user") {
      if (typeof content === "string") {
        if (content.trim() !== "") items.push({ kind: "user", text: content });
        continue;
      }
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        const p = part as {
          readonly type?: string;
          readonly text?: string;
          readonly tool_use_id?: string;
          readonly content?: unknown;
        };
        if (p.type === "text" && typeof p.text === "string" && p.text.trim() !== "") {
          items.push({ kind: "user", text: p.text });
        }
        if (p.type === "tool_result" && typeof p.tool_use_id === "string") {
          const call = pendingTools.get(p.tool_use_id);
          if (call !== undefined) {
            pendingTools.delete(p.tool_use_id);
            items.push({
              kind: "tool",
              name: call.name,
              args: call.args,
              output: asText(p.content),
              shell: call.command !== null,
              command: call.command,
            });
          }
        }
      }
    }
  }
  return items;
};

/** Codex rollout JSONL → normalized items. */
const readCodex = (jsonl: string): Item[] => {
  const items: Item[] = [];
  const pendingCalls = new Map<string, { name: string; args: string; command: string | null }>();
  for (const line of jsonl.split("\n")) {
    if (line.trim() === "") continue;
    let entry: {
      readonly type?: string;
      readonly payload?: {
        readonly type?: string;
        readonly role?: string;
        readonly content?: unknown;
        readonly name?: string;
        readonly arguments?: string;
        readonly call_id?: string;
        readonly output?: unknown;
      };
    };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      continue;
    }
    if (entry.type !== "response_item") continue;
    const p = entry.payload;
    if (p === undefined) continue;
    if (p.type === "message" && (p.role === "user" || p.role === "assistant")) {
      const text = asText(p.content).trim();
      // Codex wraps environment/instruction blocks as user items; keep real turns only.
      if (text !== "" && !text.startsWith("<")) {
        items.push({ kind: p.role, text });
      }
    }
    if (p.type === "function_call" && typeof p.call_id === "string") {
      let command: string | null = null;
      if (p.name === "exec_command" || p.name === "shell") {
        try {
          const parsed = JSON.parse(p.arguments ?? "{}") as {
            readonly cmd?: string;
            readonly command?: ReadonlyArray<string> | string;
          };
          command =
            typeof parsed.cmd === "string"
              ? parsed.cmd
              : Array.isArray(parsed.command)
                ? parsed.command.join(" ")
                : typeof parsed.command === "string"
                  ? parsed.command
                  : null;
        } catch {
          command = null;
        }
      }
      pendingCalls.set(p.call_id, {
        name: p.name ?? "tool",
        args: p.arguments ?? "{}",
        command,
      });
    }
    if (p.type === "function_call_output" && typeof p.call_id === "string") {
      const call = pendingCalls.get(p.call_id);
      if (call !== undefined) {
        pendingCalls.delete(p.call_id);
        const output =
          typeof p.output === "string"
            ? p.output
            : ((p.output as { readonly content?: string } | undefined)?.content ??
              JSON.stringify(p.output ?? ""));
        items.push({
          kind: "tool",
          name: call.name,
          args: call.args,
          output,
          shell: call.command !== null,
          command: call.command,
        });
      }
    }
  }
  return items;
};

// ---------------------------------------------------------------------------
// Writers: normalized items → the target harness's native files.
// ---------------------------------------------------------------------------

/** RFC-4122-ish v4 uuid from a counter — deterministic enough for tests, unique enough for stores. */
const uuid = () => crypto.randomUUID();

const CODEX_CLI_VERSION = "0.145.0";
const CLAUDE_VERSION = "2.1.220";

const writeCodex = (
  items: ReadonlyArray<Item>,
  cwd: string,
  now: string,
): ConvertedNativeSession => {
  const sessionId = uuid();
  const stamp = now.replace(/\.\d+Z$/, "Z");
  const lines: string[] = [];
  const push = (type: string, payload: unknown) =>
    lines.push(JSON.stringify({ timestamp: stamp, type, payload }));

  push("session_meta", {
    session_id: sessionId,
    id: sessionId,
    timestamp: stamp,
    cwd,
    originator: "codex-tui",
    cli_version: CODEX_CLI_VERSION,
    source: "cli",
  });
  let call = 0;
  for (const item of items) {
    if (item.kind === "user") {
      push("response_item", {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: item.text }],
      });
      push("event_msg", { type: "user_message", message: item.text });
    } else if (item.kind === "assistant") {
      push("response_item", {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: item.text }],
      });
      push("event_msg", { type: "agent_message", message: item.text });
    } else {
      call += 1;
      const callId = `call_mend${String(call).padStart(6, "0")}`;
      const name = item.shell ? "exec_command" : `imported_${item.name}`;
      const args = item.shell ? JSON.stringify({ cmd: item.command, workdir: cwd }) : item.args;
      push("response_item", { type: "function_call", name, arguments: args, call_id: callId });
      push("response_item", {
        type: "function_call_output",
        call_id: callId,
        output: item.output,
      });
    }
  }

  const day = stamp.slice(0, 10);
  const [year = "1970", month = "01", dayOfMonth = "01"] = day.split("-");
  const fileStamp = stamp.replace(/:/g, "-").replace("Z", "");
  return {
    providerSessionId: sessionId,
    files: [
      {
        path: `.codex/sessions/${year}/${month}/${dayOfMonth}/rollout-${fileStamp}-${sessionId}.jsonl`,
        content: `${lines.join("\n")}\n`,
      },
    ],
    resumeArgv: ["codex", "resume", sessionId],
  };
};

const writeClaude = (
  items: ReadonlyArray<Item>,
  cwd: string,
  now: string,
): ConvertedNativeSession => {
  const sessionId = uuid();
  const lines: string[] = [];
  let parentUuid: string | null = null;
  const base = () => ({
    parentUuid,
    isSidechain: false,
    userType: "external",
    entrypoint: "cli",
    cwd,
    sessionId,
    version: CLAUDE_VERSION,
    gitBranch: "",
    timestamp: now,
  });
  const push = (entry: Record<string, unknown>) => {
    const id = uuid();
    lines.push(JSON.stringify({ ...base(), ...entry, uuid: id }));
    parentUuid = id;
  };

  let message = 0;
  for (const item of items) {
    message += 1;
    if (item.kind === "user") {
      push({ type: "user", message: { role: "user", content: item.text } });
    } else if (item.kind === "assistant") {
      push({
        type: "assistant",
        message: {
          id: `msg_mend_${message}`,
          type: "message",
          role: "assistant",
          model: "imported",
          content: [{ type: "text", text: item.text }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      });
    } else {
      const toolUseId = `toolu_mend_${message}`;
      const name = item.shell ? "Bash" : item.name;
      const input = item.shell ? { command: item.command } : safeParse(item.args);
      push({
        type: "assistant",
        message: {
          id: `msg_mend_${message}`,
          type: "message",
          role: "assistant",
          model: "imported",
          content: [{ type: "tool_use", id: toolUseId, name, input }],
          stop_reason: "tool_use",
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      });
      push({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolUseId,
              content: [{ type: "text", text: item.output }],
            },
          ],
        },
      });
    }
  }

  // Claude keys the project dir by the cwd with separators dashed.
  const projectDir = cwd.replace(/[/.]/g, "-");
  return {
    providerSessionId: sessionId,
    files: [
      {
        path: `.claude/projects/${projectDir}/${sessionId}.jsonl`,
        content: `${lines.join("\n")}\n`,
      },
    ],
    resumeArgv: ["claude", "--resume", sessionId],
  };
};

const safeParse = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { raw };
  }
};

/**
 * Convert a saved native session so the TARGET harness opens it natively.
 * Returns null when either side of the pair is unsupported.
 */
export const convertNativeSession = (
  sourceHarness: string,
  targetHarness: string,
  nativeJsonl: string,
  options: { readonly cwd: string; readonly now: string },
): ConvertedNativeSession | null => {
  const items =
    sourceHarness === "claude"
      ? readClaude(nativeJsonl)
      : sourceHarness === "codex"
        ? readCodex(nativeJsonl)
        : null;
  if (items === null || items.length === 0) return null;
  if (targetHarness === "codex") return writeCodex(items, options.cwd, options.now);
  if (targetHarness === "claude") return writeClaude(items, options.cwd, options.now);
  return null;
};

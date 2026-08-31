import type { AgentItemKind } from "@mend/domain/workbench";

/**
 * The one mapping from Claude content to Mend item kinds, shared by the live
 * stream-json adapter and the native-transcript backfill so a turn replayed
 * from the transcript can never render differently from the turn as it
 * streamed. The native transcript's content blocks are the same shape the
 * live wire carries — this is a vocabulary, not a conversion.
 */
export const toolKind = (name: string): AgentItemKind => {
  if (name === "Bash" || name === "Shell") return "command-execution";
  if (name === "Write" || name === "Edit" || name === "MultiEdit") return "file-change";
  if (name === "WebSearch" || name === "WebFetch") return "web-search";
  if (name === "TodoWrite" || name.startsWith("Task")) return "plan";
  return "tool-call";
};

/** Kind of one content block (`text` · `thinking` · `tool_use`), by its type and tool name. */
export const contentBlockKind = (type: string | null, toolName: string | null): AgentItemKind =>
  type === "text"
    ? "assistant-message"
    : type === "thinking"
      ? "reasoning"
      : type === "tool_use"
        ? toolKind(toolName ?? "tool")
        : "other";

export interface AgentTurnDto {
  readonly id: string;
  readonly ordinal: number;
  readonly input: string;
  readonly status: string;
  readonly error: string | null;
  readonly createdAt: string;
}

export interface AgentItemDto {
  readonly id: string;
  /** Session-wide update cursor. It changes when an in-progress item grows. */
  readonly seq: number;
  readonly turnId: string;
  readonly kind: string;
  readonly status: string;
  readonly title: string | null;
  readonly text: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentInputOptionDto {
  readonly label: string;
  readonly description: string | null;
}

export interface AgentInputQuestionDto {
  readonly id: string;
  readonly header: string | null;
  readonly question: string;
  readonly options: ReadonlyArray<AgentInputOptionDto>;
  readonly multiSelect: boolean;
}

export interface AgentRequestDto {
  readonly id: string;
  readonly turnId: string;
  readonly kind: string;
  readonly title: string | null;
  readonly detail: unknown;
  readonly questions: ReadonlyArray<AgentInputQuestionDto> | null;
  readonly status: string;
  readonly decision: string | null;
  readonly answers: Readonly<Record<string, ReadonlyArray<string>>> | null;
  readonly createdAt: string;
}

export interface AgentConversationDto {
  readonly turns: ReadonlyArray<AgentTurnDto>;
  readonly items: ReadonlyArray<AgentItemDto>;
  readonly requests: ReadonlyArray<AgentRequestDto>;
}

export type AgentConversationEntry =
  | { readonly kind: "turn"; readonly key: string; readonly turn: AgentTurnDto }
  | { readonly kind: "item"; readonly key: string; readonly item: AgentItemDto }
  | { readonly kind: "request"; readonly key: string; readonly request: AgentRequestDto };

/** Apply cursor-delivered item updates without duplicating provider items. */
export const mergeAgentItems = (
  current: ReadonlyArray<AgentItemDto>,
  updates: ReadonlyArray<AgentItemDto>,
): ReadonlyArray<AgentItemDto> => {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of updates) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
};

/** Render authored turns first, then each turn's ordered items and human requests. */
export const buildAgentConversation = (
  conversation: AgentConversationDto,
): ReadonlyArray<AgentConversationEntry> => {
  const entries: Array<AgentConversationEntry> = [];
  const turns = conversation.turns.toSorted((a, b) => a.ordinal - b.ordinal);
  const seenItems = new Set<string>();
  const seenRequests = new Set<string>();

  for (const turn of turns) {
    entries.push({ kind: "turn", key: `turn:${turn.id}`, turn });
    const children = [
      ...conversation.items
        .filter((item) => item.turnId === turn.id && item.kind !== "user-message")
        .map((item) => ({ kind: "item" as const, at: item.createdAt, id: item.id, item })),
      ...conversation.requests
        .filter((request) => request.turnId === turn.id)
        .map((request) => ({
          kind: "request" as const,
          at: request.createdAt,
          id: request.id,
          request,
        })),
    ].toSorted((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));

    for (const child of children) {
      if (child.kind === "item") {
        seenItems.add(child.item.id);
        entries.push({ kind: "item", key: `item:${child.item.id}`, item: child.item });
      } else {
        seenRequests.add(child.request.id);
        entries.push({
          kind: "request",
          key: `request:${child.request.id}`,
          request: child.request,
        });
      }
    }
  }

  for (const item of conversation.items) {
    if (seenItems.has(item.id) || item.kind === "user-message") {
      continue;
    }
    entries.push({ kind: "item", key: `item:${item.id}`, item });
  }
  for (const request of conversation.requests) {
    if (seenRequests.has(request.id)) {
      continue;
    }
    entries.push({ kind: "request", key: `request:${request.id}`, request });
  }
  return entries;
};

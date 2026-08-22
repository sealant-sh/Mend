import { LegendList } from "@legendapp/list/react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { KeyboardStickyView, useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EvButton } from "@/components/button";
import { MendMarkdown } from "@/components/markdown";
import { MonoText, UiText } from "@/components/typography";
import {
  buildAgentConversation,
  useAgentConversation,
  useAgentConversationActions,
  type AgentConversationEntry,
  type AgentItemDto,
  type AgentRequestDto,
  type AgentRequestResponse,
  type AgentTurnDto,
} from "@/data/agent-conversation";
import { findLastMatching } from "@/data/collections";
import { radius, spacing, useEvidenceTheme } from "@/theme/evidence";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requestDetailText = (detail: unknown): string | null => {
  if (typeof detail === "string") {
    return detail === "" ? null : detail;
  }
  if (detail === null) {
    return null;
  }
  const visible = isRecord(detail) && detail.input !== undefined ? detail.input : detail;
  const text = JSON.stringify(visible, null, 2);
  return text === undefined || text === "{}" ? null : text;
};

const requestOutcome = (request: AgentRequestDto): string => {
  if (request.answers !== null) {
    return "answered";
  }
  switch (request.decision) {
    case "accept":
      return "allowed once";
    case "accept-for-session":
      return "allowed for session";
    case "decline":
      return "declined";
    case "cancel":
      return "cancelled";
    default:
      return request.status;
  }
};

const requestName = (request: AgentRequestDto): string => {
  if (request.title !== null && request.title !== "") {
    return request.title;
  }
  switch (request.kind) {
    case "command-approval":
      return "Run this command?";
    case "file-change-approval":
      return "Apply this file change?";
    case "tool-permission":
      return "Allow this tool?";
    case "user-input":
      return "The agent needs an answer";
    default:
      return "The agent needs a decision";
  }
};

function TurnRow({ turn }: { readonly turn: AgentTurnDto }) {
  const { colors } = useEvidenceTheme();
  return (
    <View
      style={{
        alignSelf: "flex-end",
        maxWidth: "85%",
        backgroundColor: colors.wash,
        borderRadius: radius.xl,
        borderBottomRightRadius: 6,
        paddingHorizontal: 14,
        paddingVertical: 10,
      }}
    >
      <UiText size={15} style={{ lineHeight: 21 }}>
        {turn.input}
      </UiText>
      {turn.error === null ? null : (
        <MonoText tone="danger" size={10.5} style={{ paddingTop: 4 }}>
          {turn.error}
        </MonoText>
      )}
    </View>
  );
}

const itemName = (item: AgentItemDto): string => {
  if (item.title !== null) {
    return item.title;
  }
  switch (item.kind) {
    case "file-change":
      return "File change";
    case "web-search":
      return "Web search";
    case "command-execution":
      return "Command";
    default:
      return "Tool";
  }
};

function ItemRow({ item }: { readonly item: AgentItemDto }) {
  const { colors } = useEvidenceTheme();
  if (item.kind === "assistant-message" && item.text !== null) {
    return (
      <View style={{ paddingHorizontal: 2 }}>
        <MendMarkdown>{item.text}</MendMarkdown>
      </View>
    );
  }
  if (item.kind === "reasoning") {
    return (
      <MonoText tone="faint" size={11} numberOfLines={3} style={{ paddingHorizontal: 2 }}>
        {item.text ?? item.title ?? "reasoning"}
        {item.status === "in-progress" ? " ▍" : ""}
      </MonoText>
    );
  }
  if (item.kind === "plan" && item.text !== null) {
    return (
      <View
        style={{
          borderLeftWidth: 2,
          borderLeftColor: colors.rule,
          paddingLeft: 11,
          paddingVertical: 2,
        }}
      >
        <MendMarkdown>{item.text}</MendMarkdown>
      </View>
    );
  }

  const failure = item.kind === "error" || item.status === "failed";
  return (
    <View
      style={{
        backgroundColor: colors.sunken,
        borderRadius: radius.md,
        borderLeftWidth: failure ? 2 : 0,
        borderLeftColor: failure ? colors.red : "transparent",
        paddingHorizontal: 12,
        paddingVertical: 8,
        gap: 3,
      }}
    >
      <MonoText tone={failure ? "danger" : "ink2"} size={11.5}>
        {itemName(item)}
        {item.status === "in-progress" ? " ▍" : ""}
      </MonoText>
      {item.text === null || item.text === "" ? null : (
        <MonoText tone="faint" size={10.5} numberOfLines={4}>
          {item.text}
        </MonoText>
      )}
    </View>
  );
}

function RequestRow({
  request,
  responding,
  onRespond,
}: {
  readonly request: AgentRequestDto;
  readonly responding: boolean;
  readonly onRespond: (requestId: string, response: AgentRequestResponse) => void;
}) {
  const { colors } = useEvidenceTheme();
  const [selected, setSelected] = useState<Readonly<Record<string, ReadonlyArray<string>>>>({});
  const [written, setWritten] = useState<Readonly<Record<string, string>>>({});
  const pending = request.status === "pending";
  const questions = request.questions ?? [];
  const expectsAnswers = request.kind === "user-input";
  const hasQuestions = expectsAnswers && questions.length > 0;
  const detail = requestDetailText(request.detail);
  const recordedAnswers = Object.entries(request.answers ?? {}).map(([questionId, answers]) => ({
    question:
      questions.find((candidate) => candidate.id === questionId)?.header ??
      questions.find((candidate) => candidate.id === questionId)?.question ??
      questionId,
    answers,
  }));

  const toggle = (questionId: string, label: string, multiSelect: boolean) => {
    setSelected((current) => {
      const values = current[questionId] ?? [];
      let next: ReadonlyArray<string>;
      if (values.includes(label)) {
        next = values.filter((value) => value !== label);
      } else {
        next = multiSelect ? [...values, label] : [label];
      }
      return { ...current, [questionId]: next };
    });
  };
  const answer = () => {
    const answers: Record<string, ReadonlyArray<string>> = {};
    for (const question of questions) {
      const custom = written[question.id]?.trim() ?? "";
      const choices = selected[question.id] ?? [];
      if (custom === "") {
        answers[question.id] = choices;
      } else {
        answers[question.id] = question.multiSelect ? [...choices, custom] : [custom];
      }
    }
    onRespond(request.id, { answers });
  };
  const canAnswer = questions.every((question) => {
    const custom = written[question.id]?.trim() ?? "";
    return (selected[question.id]?.length ?? 0) > 0 || custom !== "";
  });
  let answerLabel = hasQuestions ? "Send answer" : "Continue";
  if (responding) {
    answerLabel = "Sending…";
  }
  let pendingAction = null;
  if (pending && expectsAnswers && hasQuestions) {
    pendingAction = (
      <EvButton
        size="sm"
        label={answerLabel}
        disabled={!canAnswer || responding}
        onPress={answer}
      />
    );
  } else if (pending && expectsAnswers) {
    pendingAction = (
      <MonoText tone="danger" size={11}>
        The provider did not include a question. Stop and resume the session.
      </MonoText>
    );
  } else if (pending) {
    pendingAction = (
      <>
        <EvButton
          size="sm"
          label="Allow once"
          disabled={responding}
          onPress={() => onRespond(request.id, { decision: "accept" })}
        />
        <EvButton
          size="sm"
          variant="outline"
          label="Allow for session"
          disabled={responding}
          onPress={() => onRespond(request.id, { decision: "accept-for-session" })}
        />
        <EvButton
          size="sm"
          variant="ghost"
          label="Decline"
          disabled={responding}
          onPress={() => onRespond(request.id, { decision: "decline" })}
        />
      </>
    );
  }

  return (
    <View
      style={{
        backgroundColor: colors.panel,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.rule,
        borderLeftWidth: 2,
        borderLeftColor: pending ? colors.amber : colors.rule,
        borderRadius: radius.lg,
        padding: 12,
        gap: 10,
      }}
    >
      <View style={{ gap: 2 }}>
        <UiText weight="medium">{requestName(request)}</UiText>
        {!pending && (
          <MonoText tone="faint" size={10.5}>
            {requestOutcome(request)}
          </MonoText>
        )}
        {detail === null ? null : (
          <MonoText tone="muted" size={11}>
            {detail}
          </MonoText>
        )}
        {recordedAnswers.map((recorded) => (
          <View key={recorded.question} style={{ paddingTop: 4 }}>
            <UiText tone="muted" size={11.5}>
              {recorded.question}
            </UiText>
            <MonoText tone="ink2" size={11}>
              {recorded.answers.join(", ")}
            </MonoText>
          </View>
        ))}
      </View>

      {pending && hasQuestions
        ? questions.map((question) => (
            <View key={question.id} style={{ gap: 7 }}>
              <UiText weight="medium" size={12.5}>
                {question.header ?? question.question}
              </UiText>
              {question.header === null ? null : (
                <UiText tone="muted" size={12.5}>
                  {question.question}
                </UiText>
              )}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {question.options.map((option) => {
                  const chosen = selected[question.id]?.includes(option.label) ?? false;
                  return (
                    <Pressable
                      key={option.label}
                      onPress={() => toggle(question.id, option.label, question.multiSelect)}
                      style={{
                        borderWidth: 1,
                        borderColor: chosen ? colors.accent : colors.rule,
                        backgroundColor: chosen ? colors.wash : colors.panel,
                        borderRadius: radius.lg,
                        paddingHorizontal: 10,
                        paddingVertical: 7,
                        maxWidth: "100%",
                      }}
                    >
                      <UiText tone={chosen ? "accent" : "ink2"} size={12}>
                        {option.label}
                      </UiText>
                      {option.description === null ? null : (
                        <UiText tone="faint" size={11}>
                          {option.description}
                        </UiText>
                      )}
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                value={written[question.id] ?? ""}
                onChangeText={(value) =>
                  setWritten((current) => ({ ...current, [question.id]: value }))
                }
                placeholder="Write an answer"
                placeholderTextColor={colors.faint}
                multiline
                style={{
                  minHeight: 38,
                  maxHeight: 100,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: colors.rule,
                  borderRadius: radius.lg,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  color: colors.ink,
                  backgroundColor: colors.bg,
                  fontSize: 14,
                }}
              />
            </View>
          ))
        : null}

      {pendingAction === null ? null : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>{pendingAction}</View>
      )}
    </View>
  );
}

function ConversationRow({
  entry,
  responding,
  onRespond,
}: {
  readonly entry: AgentConversationEntry;
  readonly responding: boolean;
  readonly onRespond: (requestId: string, response: AgentRequestResponse) => void;
}) {
  switch (entry.kind) {
    case "turn":
      return <TurnRow turn={entry.turn} />;
    case "item":
      return <ItemRow item={entry.item} />;
    case "request":
      return <RequestRow request={entry.request} responding={responding} onRespond={onRespond} />;
  }
}

export function ProtocolConversation({
  sessionId,
  active,
  summary,
}: {
  readonly sessionId: string;
  readonly active: boolean;
  readonly summary: string | null;
}) {
  const { colors } = useEvidenceTheme();
  const insets = useSafeAreaInsets();
  const conversation = useAgentConversation(sessionId, true, active);
  const { submit, respond } = useAgentConversationActions(sessionId);
  const [draft, setDraft] = useState("");
  const [composerHeight, setComposerHeight] = useState(64);
  const keyboard = useKeyboardState((state) => ({
    height: state.height,
    isVisible: state.isVisible,
  }));
  const entries = useMemo(
    () =>
      buildAgentConversation(
        conversation.data ?? {
          turns: [],
          items: [],
          requests: [],
        },
      ),
    [conversation.data],
  );
  const openTurn = findLastMatching(
    conversation.data?.turns ?? [],
    (turn) => turn.status === "queued" || turn.status === "running",
  );
  const pendingRequest = conversation.data?.requests.find(
    (request) => request.status === "pending",
  );
  const bottomPad =
    (keyboard.isVisible ? keyboard.height : insets.bottom) +
    (active ? composerHeight + spacing.xs : spacing.md);
  const onRespond = useCallback(
    (requestId: string, response: AgentRequestResponse) => {
      respond.mutate({ requestId, response });
    },
    [respond],
  );
  const send = () => {
    const text = draft.trim();
    if (text === "") {
      return;
    }
    submit.mutate(text, {
      onSuccess: () => setDraft((current) => (current.trim() === text ? "" : current)),
    });
  };
  const actionError = submit.error ?? respond.error;
  let emptyMessage = summary ?? "no conversation recorded";
  if (conversation.isLoading) {
    emptyMessage = "reading the conversation…";
  } else if (conversation.isError) {
    emptyMessage = conversation.error.message;
  } else if (active) {
    emptyMessage = "ready for your first message";
  }

  return (
    <View style={{ flex: 1 }}>
      <LegendList
        data={entries}
        keyExtractor={(entry) => entry.key}
        getItemType={(entry) =>
          entry.kind === "item" ? `${entry.kind}:${entry.item.kind}` : entry.kind
        }
        renderItem={({ item }) => (
          <ConversationRow entry={item} responding={respond.isPending} onRespond={onRespond} />
        )}
        estimatedItemSize={76}
        drawDistance={500}
        alignItemsAtEnd
        initialScrollAtEnd
        maintainScrollAtEnd={{
          animated: true,
          on: { dataChange: true, itemLayout: true, layout: true },
        }}
        maintainVisibleContentPosition={{ data: true, size: true }}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: spacing.xs,
          paddingBottom: bottomPad,
          gap: 10,
        }}
        ListFooterComponent={
          active && (openTurn !== undefined || pendingRequest !== undefined) ? (
            <MonoText tone="faint" size={11.5} style={{ paddingHorizontal: 2, paddingTop: 4 }}>
              {pendingRequest === undefined ? "working…" : "waiting for your answer"}
            </MonoText>
          ) : null
        }
        ListEmptyComponent={<MonoText tone="faint">{emptyMessage}</MonoText>}
      />
      {active && (
        <KeyboardStickyView
          style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}
          offset={{ closed: 0, opened: 0 }}
        >
          {actionError instanceof Error ? (
            <View
              style={{ alignItems: "center", paddingVertical: 4, backgroundColor: colors.sunken }}
            >
              <MonoText tone="danger" size={11} numberOfLines={2}>
                {actionError.message}
              </MonoText>
            </View>
          ) : null}
          <View
            onLayout={(event) => setComposerHeight(event.nativeEvent.layout.height)}
            style={{
              flexDirection: "row",
              alignItems: "flex-end",
              gap: 8,
              paddingHorizontal: 10,
              paddingTop: 8,
              paddingBottom: keyboard.isVisible ? 8 : insets.bottom + 4,
              backgroundColor: colors.panel,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: colors.softRule,
            }}
          >
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Message the session…"
              placeholderTextColor={colors.faint}
              multiline
              style={{
                flex: 1,
                minHeight: 40,
                maxHeight: 120,
                backgroundColor: colors.bg,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: colors.rule,
                borderRadius: radius.lg,
                paddingHorizontal: 13,
                paddingVertical: 9,
                color: colors.ink,
                fontSize: 15,
              }}
            />
            <EvButton
              label={submit.isPending ? "Sending…" : "Send"}
              onPress={send}
              disabled={submit.isPending || draft.trim() === ""}
            />
          </View>
        </KeyboardStickyView>
      )}
    </View>
  );
}

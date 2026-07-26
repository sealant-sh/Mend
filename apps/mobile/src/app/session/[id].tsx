// One session as a CONVERSATION (the t3/ChatGPT shape): the canonical record
// rendered as messages — user turns, assistant prose, tool activity as quiet
// mono rows — polled live from the running workspace. The composer writes
// straight into the PTY (text + Enter). The raw terminal stays one tap away.

import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { FlatList, TextInput, View } from "react-native";
import { KeyboardStickyView, useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EvButton } from "@/components/button";
import { StatusWord } from "@/components/status";
import { MonoText, UiText } from "@/components/typography";
import {
  ACTIVE,
  loadConfig,
  toneOf,
  useSession,
  useSessionActions,
  useTranscript,
  type TranscriptEventDto,
} from "@/data/live";
import { radius, spacing, useEvidenceTheme } from "@/theme/evidence";

const COMPOSER_HEIGHT = 64;

function EventRow({ event }: { readonly event: TranscriptEventDto }) {
  const { colors } = useEvidenceTheme();
  if (event.kind === "user" && event.text !== null) {
    return (
      <View
        style={{
          alignSelf: "flex-end",
          maxWidth: "85%",
          backgroundColor: colors.wash,
          borderRadius: radius.xl,
          paddingHorizontal: 14,
          paddingVertical: 10,
        }}
      >
        <UiText>{event.text}</UiText>
      </View>
    );
  }
  if (event.kind === "assistant" && event.text !== null) {
    return (
      <View
        style={{
          alignSelf: "flex-start",
          maxWidth: "95%",
          backgroundColor: colors.panel,
          borderRadius: radius.xl,
          paddingHorizontal: 14,
          paddingVertical: 10,
        }}
      >
        <UiText>{event.text}</UiText>
      </View>
    );
  }
  if (event.kind === "reasoning" && event.text !== null) {
    return (
      <MonoText style={{ color: colors.faint, fontSize: 11 }} numberOfLines={2}>
        {event.text}
      </MonoText>
    );
  }
  if (event.kind === "tool") {
    return (
      <View style={{ gap: 2 }}>
        <MonoText style={{ color: colors.ink2, fontSize: 11.5 }}>
          {event.command !== null ? `$ ${event.command}` : `⚙ ${event.name ?? "tool"}`}
        </MonoText>
        {event.output !== null && event.output !== "" && (
          <MonoText style={{ color: colors.faint, fontSize: 10.5 }} numberOfLines={3}>
            {event.output}
          </MonoText>
        )}
      </View>
    );
  }
  return null;
}

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useEvidenceTheme();
  const insets = useSafeAreaInsets();
  const detail = useSession(id);
  const session = detail.data?.session;
  const active = session !== undefined && ACTIVE.has(session.status);
  const transcript = useTranscript(id, active);
  const { resume, stop } = useSessionActions();
  const [draft, setDraft] = useState("");
  const [base, setBase] = useState<{ url: string; token: string } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const listRef = useRef<FlatList<TranscriptEventDto> | null>(null);

  useEffect(() => {
    void loadConfig().then((config) => setBase({ url: config.url, token: config.token }));
  }, []);

  // One quiet socket for the composer: text in, PTY does the rest. Output is
  // ignored here — the transcript poll renders the conversation.
  useEffect(() => {
    if (base === null || !active || session === undefined) return;
    const url = new URL(`${base.url}/api/tty`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("session", session.id);
    url.searchParams.set("from", "0");
    url.searchParams.set("token", base.token);
    const ws = new WebSocket(url.toString());
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    return () => {
      wsRef.current = null;
      ws.close();
    };
  }, [base, active, session?.id]);

  const send = () => {
    const socket = wsRef.current;
    if (socket === null || socket.readyState !== WebSocket.OPEN || draft.trim() === "") return;
    socket.send(new TextEncoder().encode(`${draft}\r`).buffer as ArrayBuffer);
    setDraft("");
  };

  const keyboard = useKeyboardState((state) => ({
    height: state.height,
    isVisible: state.isVisible,
  }));
  const bottomPad =
    (keyboard.isVisible ? keyboard.height : insets.bottom) + (active ? COMPOSER_HEIGHT : 12);
  const events = transcript.data?.events ?? [];

  return (
    <>
      <Stack.Screen options={{ title: session?.harness ?? "session" }} />
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingHorizontal: 16,
            paddingVertical: 10,
          }}
        >
          {session !== undefined && (
            <StatusWord tone={toneOf(session.status)} word={session.status} />
          )}
          <View style={{ flex: 1 }} />
          {session !== undefined && active && (
            <EvButton
              variant="ghost"
              label={stop.isPending ? "stopping…" : "Stop"}
              onPress={() => stop.mutate(session.id)}
            />
          )}
          {session !== undefined && !active && (
            <EvButton
              label={resume.isPending ? "resuming…" : "Resume"}
              onPress={() => resume.mutate({ sessionId: session.id, harness: null })}
            />
          )}
          {session !== undefined && (
            <EvButton
              variant="outline"
              label="Terminal"
              onPress={() =>
                router.push({ pathname: "/terminal/[id]", params: { id: session.id } })
              }
            />
          )}
        </View>
        <FlatList
          ref={listRef}
          data={events}
          keyExtractor={(_, index) => String(index)}
          renderItem={({ item }) => <EventRow event={item} />}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: bottomPad,
            gap: spacing.sm,
          }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <MonoText style={{ color: colors.faint }}>
              {transcript.isLoading
                ? "reading the conversation…"
                : active
                  ? "provisioning — the conversation appears as the harness starts…"
                  : (session?.summary ?? "no conversation recorded")}
            </MonoText>
          }
        />
        {active && (
          <KeyboardStickyView
            style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}
            offset={{ closed: 0, opened: 0 }}
          >
            <View
              style={{
                flexDirection: "row",
                gap: 8,
                padding: 10,
                paddingBottom: keyboard.isVisible ? 10 : insets.bottom + 6,
                backgroundColor: colors.panel,
                borderTopWidth: 1,
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
                  borderWidth: 1,
                  borderColor: colors.rule,
                  borderRadius: radius.lg,
                  paddingHorizontal: 12,
                  paddingVertical: 9,
                  color: colors.ink,
                  fontSize: 15,
                }}
              />
              <EvButton label="Send" onPress={send} />
            </View>
          </KeyboardStickyView>
        )}
      </View>
    </>
  );
}

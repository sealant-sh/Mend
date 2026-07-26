// One session as a CONVERSATION — EV-styled: the page header pattern up top,
// panels that lift off the warm canvas for turns, tool activity as sunken
// mono strips, and the composer as a proper panel surface. Review is one
// primary action away; the raw terminal stays the escape hatch.

import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { FlatList, StyleSheet, TextInput, View } from "react-native";
import { KeyboardStickyView, useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EvButton } from "@/components/button";
import { StatusWord } from "@/components/status";
import { DisplayTitle, Eyebrow, MonoText, UiText } from "@/components/typography";
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

const COMPOSER_HEIGHT = 68;

function EventRow({ event }: { readonly event: TranscriptEventDto }) {
  const { colors, shadow } = useEvidenceTheme();
  if (event.kind === "user" && event.text !== null) {
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
        <UiText size={14.5}>{event.text}</UiText>
      </View>
    );
  }
  if (event.kind === "assistant" && event.text !== null) {
    return (
      <View
        style={{
          alignSelf: "flex-start",
          maxWidth: "94%",
          backgroundColor: colors.panel,
          borderRadius: radius.xl,
          borderBottomLeftRadius: 6,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.softRule,
          boxShadow: shadow.sm,
          paddingHorizontal: 14,
          paddingVertical: 11,
        }}
      >
        <UiText size={14.5}>{event.text}</UiText>
      </View>
    );
  }
  if (event.kind === "reasoning" && event.text !== null) {
    return (
      <MonoText tone="faint" size={11} numberOfLines={2} style={{ paddingHorizontal: 6 }}>
        {event.text}
      </MonoText>
    );
  }
  if (event.kind === "tool") {
    return (
      <View
        style={{
          backgroundColor: colors.sunken,
          borderRadius: radius.md,
          paddingHorizontal: 12,
          paddingVertical: 8,
          gap: 3,
        }}
      >
        <MonoText size={11.5} style={{ color: colors.ink2 }}>
          {event.command !== null ? `$ ${event.command}` : `⚙ ${event.name ?? "tool"}`}
        </MonoText>
        {event.output !== null && event.output !== "" && (
          <MonoText tone="faint" size={10.5} numberOfLines={3}>
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
  const change = detail.data?.change ?? null;
  const active = session !== undefined && ACTIVE.has(session.status);
  const transcript = useTranscript(id, active);
  const { resume, stop } = useSessionActions();
  const [draft, setDraft] = useState("");
  const [pendingSends, setPendingSends] = useState<ReadonlyArray<string>>([]);
  const [working, setWorking] = useState(false);
  const workingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastInvalidate = useRef(0);
  const [base, setBase] = useState<{ url: string; token: string } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const listRef = useRef<FlatList<TranscriptEventDto> | null>(null);
  const transcriptRef = useRef<(() => Promise<unknown>) | null>(null);
  transcriptRef.current = transcript.refetch;

  useEffect(() => {
    void loadConfig().then((config) => setBase({ url: config.url, token: config.token }));
  }, []);

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
    // PTY bytes are the live signal: the harness is doing something. Surface
    // it immediately (working indicator) and pull the transcript at most
    // once a second while activity flows — turns land as they happen.
    ws.onmessage = (event) => {
      if (typeof event.data === "string") return;
      setWorking(true);
      if (workingTimer.current !== null) clearTimeout(workingTimer.current);
      workingTimer.current = setTimeout(() => setWorking(false), 2_500);
      const now = Date.now();
      if (now - lastInvalidate.current > 1_000) {
        lastInvalidate.current = now;
        void transcriptRef.current?.();
      }
    };
    return () => {
      wsRef.current = null;
      if (workingTimer.current !== null) clearTimeout(workingTimer.current);
      ws.close();
    };
  }, [base, active, session?.id]);

  const send = () => {
    const socket = wsRef.current;
    const text = draft.trim();
    if (socket === null || socket.readyState !== WebSocket.OPEN || text === "") return;
    socket.send(JSON.stringify({ t: "input", data: `${draft}\r` }));
    setPendingSends((current) => [...current, text]);
    setWorking(true);
    setDraft("");
  };

  const keyboard = useKeyboardState((state) => ({
    height: state.height,
    isVisible: state.isVisible,
  }));
  const bottomPad =
    (keyboard.isVisible ? keyboard.height : insets.bottom) +
    (active ? COMPOSER_HEIGHT : spacing.md);
  const serverEvents = transcript.data?.events ?? [];
  // Optimistic reconcile: a pending send disappears once the transcript
  // carries it (compare against the tail's user turns).
  useEffect(() => {
    if (pendingSends.length === 0) return;
    const tail = new Set(
      serverEvents
        .slice(-12)
        .filter((event) => event.kind === "user")
        .map((event) => (event.text ?? "").trim()),
    );
    setPendingSends((current) => current.filter((text) => !tail.has(text)));
  }, [serverEvents.length]);
  const events: ReadonlyArray<TranscriptEventDto> = [
    ...serverEvents,
    ...pendingSends.map((text) => ({
      kind: "user",
      text,
      name: null,
      command: null,
      output: null,
    })),
  ];

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View
          style={{
            paddingTop: insets.top + spacing.sm,
            paddingHorizontal: 20,
            paddingBottom: spacing.sm,
            gap: 10,
          }}
        >
          <Eyebrow>session</Eyebrow>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <DisplayTitle>{session?.harness ?? "…"}</DisplayTitle>
            <View style={{ flex: 1 }} />
            {session !== undefined && (
              <StatusWord tone={toneOf(session.status)} word={session.status} />
            )}
          </View>
          {session !== undefined && (
            <MonoText tone="faint" size={11.5}>
              {session.id.slice(0, 8)}
              {session.settledAt === null
                ? ""
                : ` · settled ${new Date(session.settledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
            </MonoText>
          )}
          <View style={{ flexDirection: "row", gap: 8 }}>
            {change !== null && (
              <EvButton
                label="Review"
                onPress={() => router.push({ pathname: "/review/[id]", params: { id: change.id } })}
                style={{ flex: 1 }}
              />
            )}
            {session !== undefined && !active && (
              <EvButton
                variant={change === null ? "primary" : "outline"}
                label={resume.isPending ? "resuming…" : "Resume"}
                onPress={() => resume.mutate({ sessionId: session.id, harness: null })}
                style={{ flex: 1 }}
              />
            )}
            {session !== undefined && (
              <EvButton
                variant="outline"
                label="Terminal"
                onPress={() =>
                  router.push({ pathname: "/terminal/[id]", params: { id: session.id } })
                }
                style={{ flex: 1 }}
              />
            )}
            {session !== undefined && active && (
              <EvButton
                variant="ghost"
                label={stop.isPending ? "…" : "Stop"}
                onPress={() => stop.mutate(session.id)}
              />
            )}
          </View>
        </View>
        <FlatList
          ref={listRef}
          data={events}
          keyExtractor={(_, index) => String(index)}
          renderItem={({ item }) => <EventRow event={item} />}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: spacing.sm,
            paddingBottom: bottomPad,
            gap: 10,
          }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListFooterComponent={
            working && active ? (
              <MonoText tone="faint" size={11.5} style={{ paddingHorizontal: 6, paddingTop: 4 }}>
                ▍ working…
              </MonoText>
            ) : null
          }
          ListEmptyComponent={
            <MonoText tone="faint">
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
                alignItems: "flex-end",
                gap: 8,
                paddingHorizontal: 12,
                paddingTop: 10,
                paddingBottom: keyboard.isVisible ? 10 : insets.bottom + 6,
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
                  minHeight: 42,
                  maxHeight: 120,
                  backgroundColor: colors.bg,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: colors.rule,
                  borderRadius: radius.lg,
                  paddingHorizontal: 13,
                  paddingVertical: 10,
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

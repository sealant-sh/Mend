// One session as a CONVERSATION. The list is a LegendList tuned the way
// t3code tunes theirs (MIT — pingdotgg/t3code apps/mobile ThreadFeed):
// maintainScrollAtEnd owns bottom-following (it only re-pins when the list
// is already at the end, so scrolling up to read is never fought), and
// maintainVisibleContentPosition compensates both data appends and in-place
// row growth so streamed turns never shove the viewport. Chrome is spent on
// the conversation: one compact header row, assistant prose full-bleed on
// the sheet, and a floating composer whose measured height is the list's
// only bottom inset.

import { LegendList } from "@legendapp/list/react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { KeyboardStickyView, useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EvButton } from "@/components/button";
import { StatusWord } from "@/components/status";
import { DisplayTitle, MonoText, UiText } from "@/components/typography";
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

interface FeedEntry {
  readonly key: string;
  readonly event: TranscriptEventDto;
}

const sameEvent = (a: TranscriptEventDto, b: TranscriptEventDto): boolean =>
  a.kind === b.kind &&
  a.text === b.text &&
  a.name === b.name &&
  a.command === b.command &&
  a.output === b.output;

// The transcript poll rebuilds every event object each round; compare by
// value so settled rows skip the re-render and only the growing tail paints.
const EventRow = memo(
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
            borderBottomRightRadius: 6,
            paddingHorizontal: 14,
            paddingVertical: 10,
          }}
        >
          <UiText size={15} style={{ lineHeight: 21 }}>
            {event.text}
          </UiText>
        </View>
      );
    }
    if (event.kind === "assistant" && event.text !== null) {
      // Full-bleed prose on the sheet — the report needs width, not a card.
      return (
        <UiText size={15} style={{ lineHeight: 23, paddingHorizontal: 2 }}>
          {event.text}
        </UiText>
      );
    }
    if (event.kind === "reasoning" && event.text !== null) {
      return (
        <MonoText tone="faint" size={11} numberOfLines={2} style={{ paddingHorizontal: 2 }}>
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
  },
  (prev, next) => sameEvent(prev.event, next.event),
);

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
  const [pendingSends, setPendingSends] = useState<
    ReadonlyArray<{ readonly id: number; readonly text: string }>
  >([]);
  const pendingSeq = useRef(0);
  const [working, setWorking] = useState(false);
  const workingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastInvalidate = useRef(0);
  const [base, setBase] = useState<{ url: string; token: string } | null>(null);
  const [composerHeight, setComposerHeight] = useState(64);
  const wsRef = useRef<WebSocket | null>(null);
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
    ws.addEventListener("message", (event) => {
      if (typeof event.data === "string") return;
      setWorking(true);
      if (workingTimer.current !== null) clearTimeout(workingTimer.current);
      workingTimer.current = setTimeout(() => setWorking(false), 2_500);
      const now = Date.now();
      if (now - lastInvalidate.current > 1_000) {
        lastInvalidate.current = now;
        void transcriptRef.current?.();
      }
    });
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
    pendingSeq.current += 1;
    setPendingSends((current) => [...current, { id: pendingSeq.current, text }]);
    setWorking(true);
    setDraft("");
  };

  const keyboard = useKeyboardState((state) => ({
    height: state.height,
    isVisible: state.isVisible,
  }));
  const bottomPad =
    (keyboard.isVisible ? keyboard.height : insets.bottom) +
    (active ? composerHeight + spacing.xs : spacing.md);
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
    setPendingSends((current) => current.filter((pending) => !tail.has(pending.text)));
  }, [serverEvents.length]);
  // Stable keys: server events are append-only (positional keys never move),
  // pending sends carry their own ids — a confirmed send swaps key, not rows.
  const feed = useMemo<ReadonlyArray<FeedEntry>>(
    () => [
      ...serverEvents.map((event, index) => ({ key: `s${index}`, event })),
      ...pendingSends.map((pending) => ({
        key: `p${pending.id}`,
        event: {
          kind: "user",
          text: pending.text,
          name: null,
          command: null,
          output: null,
        },
      })),
    ],
    [serverEvents, pendingSends],
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View
          style={{
            paddingTop: insets.top + 4,
            paddingHorizontal: 16,
            paddingBottom: spacing.xs,
            gap: 8,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <DisplayTitle style={{ fontSize: 18, lineHeight: 23, letterSpacing: -0.3 }}>
              {session?.harness ?? "…"}
            </DisplayTitle>
            <View style={{ flex: 1 }} />
            {session !== undefined && (
              <StatusWord tone={toneOf(session.status)} word={session.status} />
            )}
          </View>
          {session !== undefined && (
            <View style={{ flexDirection: "row", gap: 8 }}>
              {change !== null && (
                <EvButton
                  size="sm"
                  label="Review"
                  onPress={() =>
                    router.push({ pathname: "/review/[id]", params: { id: change.id } })
                  }
                />
              )}
              {!active && (
                <EvButton
                  size="sm"
                  variant={change === null ? "primary" : "outline"}
                  label={resume.isPending ? "resuming…" : "Resume"}
                  onPress={() => resume.mutate({ sessionId: session.id, harness: null })}
                />
              )}
              <EvButton
                size="sm"
                variant="outline"
                label="Terminal"
                onPress={() =>
                  router.push({ pathname: "/terminal/[id]", params: { id: session.id } })
                }
              />
              <View style={{ flex: 1 }} />
              {active && (
                <EvButton
                  size="sm"
                  variant="ghost"
                  label={stop.isPending ? "…" : "Stop"}
                  onPress={() => stop.mutate(session.id)}
                />
              )}
            </View>
          )}
        </View>
        <LegendList
          data={feed}
          keyExtractor={(entry) => entry.key}
          getItemType={(entry) => entry.event.kind}
          renderItem={({ item }) => <EventRow event={item.event} />}
          estimatedItemSize={72}
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
            working && active ? (
              <MonoText tone="faint" size={11.5} style={{ paddingHorizontal: 2, paddingTop: 4 }}>
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
              <EvButton label="Send" onPress={send} />
            </View>
          </KeyboardStickyView>
        )}
      </View>
    </>
  );
}

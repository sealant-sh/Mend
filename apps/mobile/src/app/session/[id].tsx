// Session — the live run and its durable record (plan §6.3): the run-record
// panel with evidence rows, a terminal peek, controls to answer, stop, or
// open a terminal, and the link into review.

import { useLocalSearchParams, useRouter } from "expo-router";
import { TextInput, View } from "react-native";

import { EvButton } from "@/components/button";
import { Panel } from "@/components/panel";
import { EvidenceRow, Seal, TerminalPeek } from "@/components/record";
import { Screen, ScreenHeader, SectionLabel } from "@/components/screen";
import { BodyText, MonoText } from "@/components/typography";
import { changeStats, count, sessionById } from "@/data/mock";
import { fontFamilies, radius, useEvidenceTheme } from "@/theme/evidence";

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useEvidenceTheme();
  const session = sessionById(id);
  if (!session) {
    return (
      <Screen>
        <BodyText tone="muted">This session has no record here.</BodyText>
      </Screen>
    );
  }
  const live = session.state === "running" || session.state === "waiting";

  return (
    <Screen>
      <ScreenHeader
        eyebrow={`session · ${session.harness}`}
        title={session.title}
        meta={`${session.runId} · ${session.projectId} · started ${session.startedAt}${session.contextPack ? ` · context ${session.contextPack}` : ""}`}
      />

      <Panel lift={live}>
        <Seal
          runId={session.runId}
          live={live}
          status={{ word: session.statusWord, tone: session.statusTone }}
        />
        {session.events.map((event, i) => (
          <EvidenceRow key={event.seq} event={event} first={i === 0} />
        ))}
        {session.terminal ? <TerminalPeek lines={session.terminal} /> : null}
        <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
          <MonoText tone="faint" size={11}>
            {live ? "streaming" : "settled"} · {session.eventCount} events
          </MonoText>
        </View>
      </Panel>

      {live ? (
        <>
          <SectionLabel>Send guidance</SectionLabel>
          <View style={{ gap: 12 }}>
            <TextInput
              placeholder="Answer, steer, or add an instruction…"
              placeholderTextColor={colors.faint}
              multiline
              style={{
                minHeight: 72,
                backgroundColor: colors.panel,
                borderWidth: 1,
                borderColor: colors.rule,
                borderRadius: radius.lg,
                paddingHorizontal: 14,
                paddingVertical: 10,
                fontFamily: fontFamilies.sans.regular,
                fontSize: 14.5,
                color: colors.ink,
                textAlignVertical: "top",
              }}
            />
            <EvButton label="Send to session" />
            <View style={{ flexDirection: "row", gap: 12 }}>
              <EvButton label="Open terminal" variant="outline" style={{ flex: 1 }} />
              <EvButton label="Stop" variant="outline" style={{ flex: 1 }} />
            </View>
          </View>
        </>
      ) : null}

      {session.change ? (
        <>
          <SectionLabel>Change</SectionLabel>
          <View style={{ gap: 12 }}>
            <MonoText tone="muted" size={12}>
              {changeStats(session.change)} · {count(session.change.checksObserved, "check")}{" "}
              observed
            </MonoText>
            <EvButton
              label="Review this change"
              onPress={() => router.push({ pathname: "/review/[id]", params: { id: session.id } })}
            />
          </View>
        </>
      ) : null}
    </Screen>
  );
}

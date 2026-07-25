// Review — the change overview, files, a readable unified diff, and the loop
// back to the agent (plan §6.4). Observations, never verdicts; comments
// return to the same session as an editable follow-up instruction.

import { useLocalSearchParams } from "expo-router";
import { StyleSheet, TextInput, View } from "react-native";

import { EvButton } from "@/components/button";
import { Panel, PanelRow } from "@/components/panel";
import { DiffPeek } from "@/components/record";
import { Screen, ScreenHeader, SectionLabel } from "@/components/screen";
import { StatusWord } from "@/components/status";
import { BodyText, MonoText, UiText } from "@/components/typography";
import { changeStats, count, projectById, sessionById } from "@/data/mock";
import { fontFamilies, radius, useEvidenceTheme } from "@/theme/evidence";

export default function ReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useEvidenceTheme();
  const session = sessionById(id);
  const change = session?.change;
  if (!session || !change) {
    return (
      <Screen>
        <BodyText tone="muted">No reviewable change for this session.</BodyText>
      </Screen>
    );
  }
  const base = projectById(session.projectId)?.branch ?? "main";

  return (
    <Screen>
      <ScreenHeader
        eyebrow={`change · ${session.runId}`}
        title={session.title}
        meta={`${session.projectId} worktree vs ${base} · ${changeStats(change)}`}
      />

      <SectionLabel>Overview</SectionLabel>
      <Panel>
        <PanelRow first>
          <View style={{ gap: 6 }}>
            <StatusWord
              tone="observed"
              word={`${count(change.checksObserved, "check")} observed`}
            />
            <MonoText tone="muted" size={11.5}>
              pnpm test · exit 0 · tsgo --noEmit · exit 0
            </MonoText>
          </View>
        </PanelRow>
        {change.notExercised === undefined ? null : (
          <PanelRow>
            <View style={{ gap: 6 }}>
              <StatusWord tone="waiting" word="Not executed" />
              <UiText tone="ink2" size={13.5}>
                {change.notExercised}
              </UiText>
            </View>
          </PanelRow>
        )}
        <PanelRow>
          <MonoText tone="faint" size={11}>
            evidence: {session.eventCount} events · context {session.contextPack ?? "none"}
          </MonoText>
        </PanelRow>
      </Panel>

      <SectionLabel>Files</SectionLabel>
      <Panel>
        {change.files.map((file, i) => (
          <View
            key={file.path}
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 12,
              paddingHorizontal: 16,
              paddingVertical: 10,
              ...(i === 0
                ? {}
                : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.faintRule }),
            }}
          >
            <MonoText tone="ink2" size={12} numberOfLines={1} style={{ flexShrink: 1 }}>
              {file.path}
            </MonoText>
            <MonoText size={11.5}>
              <MonoText tone="success" size={11.5}>
                +{file.additions}
              </MonoText>{" "}
              <MonoText tone="danger" size={11.5}>
                −{file.deletions}
              </MonoText>
            </MonoText>
          </View>
        ))}
        <DiffPeek file={change.diffPeek.file} lines={change.diffPeek.lines} />
      </Panel>

      <SectionLabel>Review</SectionLabel>
      <View style={{ gap: 12 }}>
        <TextInput
          placeholder="Comment on this change…"
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
        <EvButton label="Send review to session" />
        <MonoText tone="faint" size={11} style={{ textAlign: "center" }}>
          Comments return to {session.runId} as an editable follow-up instruction.
        </MonoText>
      </View>
    </Screen>
  );
}

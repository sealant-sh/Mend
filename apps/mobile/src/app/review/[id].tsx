// Review, phone-sized v1: the change's files with +/- counts, honest and
// live. Full diff reading and line comments follow; the laptop keeps those.

import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { Panel, PanelRow } from "@/components/panel";
import { Screen, ScreenHeader } from "@/components/screen";
import { MonoText, UiText } from "@/components/typography";
import { useChangeDiff } from "@/data/live";
import { useEvidenceTheme } from "@/theme/evidence";

export default function ReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useEvidenceTheme();
  const diff = useChangeDiff(id ?? null);
  const files = diff.data?.files ?? [];

  return (
    <Screen>
      <ScreenHeader
        eyebrow="review"
        title="The change"
        meta={
          diff.isLoading
            ? "reading the worktree…"
            : `${files.length} file${files.length === 1 ? "" : "s"} changed`
        }
      />
      <Panel>
        {files.length === 0 ? (
          <View style={{ padding: 16 }}>
            <MonoText>
              {diff.isLoading ? "loading…" : "the worktree matches its base — nothing to review"}
            </MonoText>
          </View>
        ) : (
          files.map((file, index) => (
            <PanelRow key={file.path} first={index === 0}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                <UiText style={{ flexShrink: 1 }}>{file.path}</UiText>
                <MonoText>
                  <MonoText style={{ color: colors.addEdge }}>+{file.additions}</MonoText>{" "}
                  <MonoText style={{ color: colors.delEdge }}>−{file.deletions}</MonoText>
                </MonoText>
              </View>
            </PanelRow>
          ))
        )}
      </Panel>
    </Screen>
  );
}

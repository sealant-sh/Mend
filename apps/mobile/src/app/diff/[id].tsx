// The accumulated change as a plain unified diff — the git story without
// the review apparatus (plan §7.4: readable unified diffs). Worktree versus
// session base; pull to refresh while the agent keeps writing. Review is the
// place for comments and tours — this screen only shows the evidence.

import { useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BASE_LINE_H, CodeChunk, parseFiles, TOTAL_BUDGET } from "@/components/diff";
import { Panel } from "@/components/panel";
import { ScreenHeader } from "@/components/screen";
import { MonoText, UiText, useTextScale } from "@/components/typography";
import { useChangeDiff } from "@/data/live";
import { spacing, useEvidenceTheme } from "@/theme/evidence";

export default function DiffScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useEvidenceTheme();
  const insets = useSafeAreaInsets();
  const textScale = useTextScale();
  const lineH = Math.round(BASE_LINE_H * textScale);

  const diffQuery = useChangeDiff(id ?? null);
  const change = diffQuery.data?.change ?? null;
  const stats = diffQuery.data?.files ?? [];
  const diffText = diffQuery.data?.diff ?? "";
  const files = useMemo(() => parseFiles(diffText), [diffText]);

  // Past the render budget, later files start collapsed — same discipline as
  // Review: the header with its counts is the whole story until opened.
  const defaultCollapsed = useMemo(() => {
    const set = new Set<string>();
    let used = 0;
    files.forEach((file, index) => {
      if (index > 0 && used + file.rows.length > TOTAL_BUDGET) set.add(file.path);
      else used += file.rows.length;
    });
    return set;
  }, [files]);
  const [collapsedOverride, setCollapsedOverride] = useState<Record<string, boolean>>({});
  const isCollapsed = (path: string) => collapsedOverride[path] ?? defaultCollapsed.has(path);

  const additions = stats.reduce((sum, file) => sum + file.additions, 0);
  const deletions = stats.reduce((sum, file) => sum + file.deletions, 0);

  let body = null;
  if (diffQuery.isLoading) {
    body = <MonoText tone="faint">reading the change…</MonoText>;
  } else if (diffQuery.isError) {
    body = (
      <MonoText tone="danger" numberOfLines={4}>
        {diffQuery.error.message}
      </MonoText>
    );
  } else if (files.length === 0) {
    body = <MonoText tone="faint">no changes in the worktree yet</MonoText>;
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      refreshControl={
        <RefreshControl
          refreshing={diffQuery.isRefetching}
          onRefresh={() => void diffQuery.refetch()}
          tintColor={colors.faint}
        />
      }
      contentContainerStyle={{
        paddingTop: spacing.md,
        paddingHorizontal: 14,
        paddingBottom: spacing.xl2 + insets.bottom,
        gap: spacing.md,
      }}
    >
      <ScreenHeader
        eyebrow="diff"
        title={change === null ? "Change" : change.branch}
        {...(change === null
          ? {}
          : {
              meta: `${change.baseSha.slice(0, 7)} → ${change.headSha?.slice(0, 7) ?? "worktree"} · ${stats.length} file${stats.length === 1 ? "" : "s"} · +${additions} −${deletions}`,
            })}
      />
      {body}
      {files.map((file) => {
        const stat = stats.find((candidate) => candidate.path === file.path);
        const collapsedHere = isCollapsed(file.path);
        return (
          <Panel key={file.path}>
            <Pressable
              onPress={() =>
                setCollapsedOverride((previous) => ({
                  ...previous,
                  [file.path]: !collapsedHere,
                }))
              }
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                backgroundColor: colors.sunken,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderBottomWidth: collapsedHere ? 0 : StyleSheet.hairlineWidth,
                borderBottomColor: colors.faintRule,
              }}
            >
              <UiText weight="medium" size={12} numberOfLines={1} style={{ flex: 1 }}>
                {file.path}
              </UiText>
              <MonoText size={10.5} tone="faint">
                +{stat?.additions ?? 0} −{stat?.deletions ?? 0} {collapsedHere ? "▸" : "▾"}
              </MonoText>
            </Pressable>
            {!collapsedHere && (
              <View style={{ paddingVertical: 6 }}>
                <CodeChunk rows={file.rows} lineH={lineH} highlight={null} onPressLine={() => {}} />
                {file.hidden > 0 && (
                  <MonoText
                    size={10.5}
                    tone="faint"
                    style={{ paddingHorizontal: 12, paddingTop: 6 }}
                  >
                    {file.hidden} more line{file.hidden === 1 ? "" : "s"} not shown
                  </MonoText>
                )}
              </View>
            )}
          </Panel>
        );
      })}
    </ScrollView>
  );
}

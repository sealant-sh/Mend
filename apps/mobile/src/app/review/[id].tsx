// Review, phone-sized: the real diff, rendered natively — per-file blocks,
// edge-colored add/del lines, hunk headers in accent. Line comments and the
// send-review flow stay on the laptop for now.

import { useLocalSearchParams } from "expo-router";
import { ScrollView, View } from "react-native";

import { Panel } from "@/components/panel";
import { Screen, ScreenHeader } from "@/components/screen";
import { MonoText, UiText } from "@/components/typography";
import { useChangeDiff } from "@/data/live";
import { useEvidenceTheme } from "@/theme/evidence";

const MAX_LINES = 900;

interface FileBlock {
  readonly path: string;
  readonly lines: ReadonlyArray<string>;
}

const parseFiles = (diff: string): ReadonlyArray<FileBlock> => {
  const files: Array<{ path: string; lines: string[] }> = [];
  let rendered = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const path = line.split(" b/").at(-1) ?? line;
      files.push({ path, lines: [] });
      continue;
    }
    const current = files.at(-1);
    if (current === undefined || rendered >= MAX_LINES) continue;
    if (
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("new file") ||
      line.startsWith("deleted file")
    ) {
      continue;
    }
    current.lines.push(line);
    rendered += 1;
  }
  return files;
};

export default function ReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useEvidenceTheme();
  const diff = useChangeDiff(id ?? null);
  const files = parseFiles(diff.data?.diff ?? "");
  const stats = diff.data?.files ?? [];

  return (
    <Screen>
      <ScreenHeader
        eyebrow="review"
        title="The change"
        meta={
          diff.isLoading
            ? "reading the worktree…"
            : `${stats.length} file${stats.length === 1 ? "" : "s"} · +${stats.reduce((n, f) => n + f.additions, 0)} −${stats.reduce((n, f) => n + f.deletions, 0)}`
        }
      />
      {files.length === 0 && (
        <Panel>
          <View style={{ padding: 16 }}>
            <MonoText>
              {diff.isLoading ? "loading…" : "the worktree matches its base — nothing to review"}
            </MonoText>
          </View>
        </Panel>
      )}
      {files.map((file) => (
        <Panel key={file.path}>
          <View
            style={{
              backgroundColor: colors.sunken,
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}
          >
            <UiText weight="medium" size={12}>
              {file.path}
            </UiText>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ paddingVertical: 6 }}>
              {file.lines.map((line, index) => {
                const kind = line.startsWith("@@")
                  ? "hunk"
                  : line.startsWith("+")
                    ? "add"
                    : line.startsWith("-")
                      ? "del"
                      : "ctx";
                return (
                  <View
                    key={index}
                    style={{
                      flexDirection: "row",
                      backgroundColor:
                        kind === "add"
                          ? colors.addBg
                          : kind === "del"
                            ? colors.delBg
                            : "transparent",
                      borderLeftWidth: kind === "add" || kind === "del" ? 2 : 0,
                      borderLeftColor: kind === "add" ? colors.addEdge : colors.delEdge,
                      paddingHorizontal: 10,
                    }}
                  >
                    <MonoText
                      style={{
                        fontSize: 11,
                        lineHeight: 17,
                        color:
                          kind === "hunk"
                            ? colors.accent
                            : kind === "ctx"
                              ? colors.ink2
                              : colors.ink,
                      }}
                    >
                      {line === "" ? " " : line}
                    </MonoText>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        </Panel>
      ))}
    </Screen>
  );
}

// The unified diff, phone-sized: a parser that keeps only what a phone can
// render (per-file cap, new-line coordinates for anchoring) and the row run
// renderer. Shared by Review (comment anchors, tour highlights) and the plain
// Diff screen (read-only: no-op press, no highlight).

import { Pressable, ScrollView, View } from "react-native";

import { MonoText } from "@/components/typography";
import { useEvidenceTheme } from "@/theme/evidence";

/** Per-file and whole-change render caps — a phone is not the desktop diff. */
export const FILE_LINE_CAP = 400;
export const TOTAL_BUDGET = 1200;
/** Unscaled row height; multiplied by the user's text scale. */
export const BASE_LINE_H = 17;

export interface DiffRow {
  readonly kind: "hunk" | "add" | "del" | "ctx";
  readonly text: string;
  /** New-file line number — the coordinate comments and tour stops anchor to. */
  readonly newLine: number | null;
}

export interface FileBlock {
  readonly path: string;
  readonly rows: ReadonlyArray<DiffRow>;
  readonly hidden: number;
}

const META_PREFIXES = [
  "index ",
  "--- ",
  "+++ ",
  "new file",
  "deleted file",
  "similarity index",
  "rename from",
  "rename to",
  "old mode",
  "new mode",
  "Binary files",
];

export const parseFiles = (diff: string): ReadonlyArray<FileBlock> => {
  const files: Array<{ path: string; rows: Array<DiffRow>; hidden: number }> = [];
  let newLine = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      files.push({ path: line.split(" b/").at(-1) ?? line, rows: [], hidden: 0 });
      newLine = 0;
      continue;
    }
    const current = files.at(-1);
    // "" is a split artifact — real context lines carry their space prefix.
    if (current === undefined || line === "") continue;
    if (META_PREFIXES.some((prefix) => line.startsWith(prefix))) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(line);
    let row: DiffRow;
    if (hunk !== null) {
      newLine = Number(hunk[1] ?? "0");
      row = { kind: "hunk", text: line, newLine: null };
    } else if (line.startsWith("+")) {
      row = { kind: "add", text: line, newLine };
      newLine += 1;
    } else if (line.startsWith("-")) {
      row = { kind: "del", text: line, newLine: null };
    } else {
      row = { kind: "ctx", text: line, newLine };
      newLine += 1;
    }
    if (current.rows.length >= FILE_LINE_CAP) current.hidden += 1;
    else current.rows.push(row);
  }
  return files;
};

/** A run of diff rows in one horizontal scroll; comments split the runs. */
export function CodeChunk({
  rows,
  lineH,
  highlight,
  onPressLine,
}: {
  readonly rows: ReadonlyArray<DiffRow>;
  readonly lineH: number;
  readonly highlight: { readonly start: number; readonly end: number } | null;
  readonly onPressLine: (line: number) => void;
}) {
  const { colors } = useEvidenceTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ minWidth: "100%" }}>
        {rows.map((row, index) => {
          const highlighted =
            highlight !== null &&
            row.newLine !== null &&
            row.newLine >= highlight.start &&
            row.newLine <= highlight.end;
          const background =
            highlighted && row.kind === "ctx"
              ? colors.wash
              : row.kind === "add"
                ? colors.addBg
                : row.kind === "del"
                  ? colors.delBg
                  : "transparent";
          const edge = highlighted
            ? colors.accent
            : row.kind === "add"
              ? colors.addEdge
              : colors.delEdge;
          const hasEdge = highlighted || row.kind === "add" || row.kind === "del";
          return (
            <Pressable
              key={index}
              disabled={row.newLine === null}
              onPress={() => {
                if (row.newLine !== null) onPressLine(row.newLine);
              }}
              style={{
                flexDirection: "row",
                height: lineH,
                backgroundColor: background,
                borderLeftWidth: hasEdge ? 2 : 0,
                borderLeftColor: edge,
              }}
            >
              <MonoText
                size={9.5}
                tone="faint"
                style={{ width: 42, textAlign: "right", paddingRight: 8, lineHeight: lineH }}
              >
                {row.newLine ?? ""}
              </MonoText>
              <MonoText
                size={11}
                style={{
                  lineHeight: lineH,
                  paddingRight: 16,
                  color:
                    row.kind === "hunk"
                      ? colors.accent
                      : row.kind === "ctx"
                        ? colors.ink2
                        : colors.ink,
                }}
              >
                {row.text === "" ? " " : row.text}
              </MonoText>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

// The run-record motif, ported from the marketing/platform reference: a seal
// (recording pulse + mono run id), hairline-divided mono evidence rows, a
// terminal peek, and a diff peek with 2px edge-marks — never flooded color.

import { StyleSheet, View } from "react-native";

import type { StatusTone } from "@/components/status";
import { StatusWord } from "@/components/status";
import { MonoText } from "@/components/typography";
import { radius, spacing, useEvidenceTheme } from "@/theme/evidence";

export interface RecordEvent {
  readonly seq: number;
  readonly offset: string;
  readonly name: string;
  readonly detail?: string;
}

export interface DiffLine {
  readonly sign: "+" | "-" | " ";
  readonly text: string;
}

/** The corner seal: pulse + run id on the left, dot+word status on the right. */
export function Seal({
  runId,
  status,
  live = false,
}: {
  readonly runId: string;
  readonly status: { readonly word: string; readonly tone: StatusTone };
  readonly live?: boolean;
}) {
  const { colors } = useEvidenceTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.rule,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 }}>
        <StatusWord tone={live ? "live" : status.tone} word={runId} size={12} />
      </View>
      <StatusWord tone={status.tone} word={status.word} />
    </View>
  );
}

export function EvidenceRow({
  event,
  first = false,
}: {
  readonly event: RecordEvent;
  readonly first?: boolean;
}) {
  const { colors } = useEvidenceTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 10,
        paddingHorizontal: 16,
        paddingVertical: 8,
        ...(first
          ? {}
          : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.faintRule }),
      }}
    >
      <MonoText tone="faint" size={11} style={{ width: 34, textAlign: "right" }}>
        {event.seq.toString().padStart(4, "0")}
      </MonoText>
      <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", columnGap: 8 }}>
        <MonoText tone="faint" size={11}>
          {event.offset}
        </MonoText>
        <MonoText tone="ink2" size={12}>
          {event.name}
        </MonoText>
        {event.detail === undefined ? null : (
          <MonoText tone="muted" size={12}>
            {event.detail}
          </MonoText>
        )}
      </View>
    </View>
  );
}

/** A quiet PTY excerpt on the sunken surface — the recorder's voice. */
export function TerminalPeek({ lines }: { readonly lines: ReadonlyArray<string> }) {
  const { colors } = useEvidenceTheme();
  return (
    <View
      style={{
        backgroundColor: colors.sunken,
        borderRadius: radius.lg,
        marginHorizontal: 16,
        marginVertical: spacing.sm,
        paddingHorizontal: 12,
        paddingVertical: 10,
      }}
    >
      {lines.map((line, i) => (
        <MonoText key={i} tone={line.startsWith("$") ? "ink2" : "muted"} size={11.5}>
          {line}
        </MonoText>
      ))}
    </View>
  );
}

export function DiffPeek({
  file,
  lines,
}: {
  readonly file: string;
  readonly lines: ReadonlyArray<DiffLine>;
}) {
  const { colors } = useEvidenceTheme();
  return (
    <View>
      <View
        style={{
          backgroundColor: colors.sunken,
          paddingHorizontal: 16,
          paddingVertical: 6,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.faintRule,
        }}
      >
        <MonoText tone="faint" size={11}>
          {file}
        </MonoText>
      </View>
      <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
        {lines.map((line, i) => {
          const edge =
            line.sign === "+"
              ? { borderLeftColor: colors.addEdge, backgroundColor: colors.addBg }
              : line.sign === "-"
                ? { borderLeftColor: colors.delEdge, backgroundColor: colors.delBg }
                : { borderLeftColor: "transparent" };
          return (
            <View
              key={i}
              style={{ borderLeftWidth: 2, paddingLeft: 10, paddingVertical: 1, ...edge }}
            >
              <MonoText tone="ink2" size={12} numberOfLines={1}>
                <MonoText tone="faint" size={12}>
                  {line.sign}{" "}
                </MonoText>
                {line.text}
              </MonoText>
            </View>
          );
        })}
      </View>
    </View>
  );
}

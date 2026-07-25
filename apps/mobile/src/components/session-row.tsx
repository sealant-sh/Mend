// One session as a pressable panel row: mono provenance line (harness ·
// project), the instruction in human language, a dot+word status.

import { Pressable, StyleSheet, View } from "react-native";

import { StatusWord } from "@/components/status";
import { MonoText, UiText } from "@/components/typography";
import type { Session } from "@/data/mock";
import { changeStats, count } from "@/data/mock";
import { useEvidenceTheme } from "@/theme/evidence";

export function SessionRow({
  session,
  first = false,
  onPress,
}: {
  readonly session: Session;
  readonly first?: boolean;
  readonly onPress?: () => void;
}) {
  const { colors } = useEvidenceTheme();
  const detail =
    session.state === "running"
      ? (session.events.at(-1)?.detail ?? null)
      : session.change
        ? `${changeStats(session.change)} · ${count(session.change.checksObserved, "check")} observed`
        : null;
  return (
    <Pressable
      {...(onPress ? { onPress } : {})}
      style={({ pressed }) => [
        {
          paddingHorizontal: 16,
          paddingVertical: 12,
          gap: 4,
          ...(first
            ? {}
            : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.faintRule }),
        },
        pressed && { backgroundColor: colors.sunken },
      ]}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <MonoText tone="faint" size={11}>
          {session.harness} · {session.projectId}
        </MonoText>
        <StatusWord tone={session.statusTone} word={session.statusWord} size={11} />
      </View>
      <UiText weight="medium" size={14.5} numberOfLines={2}>
        {session.title}
      </UiText>
      {detail === null ? null : (
        <MonoText tone="muted" size={11.5}>
          {detail}
        </MonoText>
      )}
    </Pressable>
  );
}

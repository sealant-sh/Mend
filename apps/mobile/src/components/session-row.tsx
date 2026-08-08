// One session as a pressable panel row: mono provenance line (harness ·
// project), the instruction in human language, a dot+word status. Takes a
// plain view struct — the live adapter (`toSession`) produces it.

import { Pressable, StyleSheet, View } from "react-native";

import type { StatusTone } from "@/components/status";
import { StatusWord } from "@/components/status";
import { MonoText, UiText } from "@/components/typography";
import { useEvidenceTheme } from "@/theme/evidence";

export interface SessionRowView {
  readonly id: string;
  readonly harness: string;
  /** Display label — the project's name, not its id. */
  readonly projectId: string;
  readonly title: string;
  readonly statusWord: string;
  readonly statusTone: StatusTone;
}

export function SessionRow({
  session,
  detail = null,
  first = false,
  onPress,
}: {
  readonly session: SessionRowView;
  /** Optional mono second line: change stats, last progress, settle summary. */
  readonly detail?: string | null;
  readonly first?: boolean;
  readonly onPress?: () => void;
}) {
  const { colors } = useEvidenceTheme();
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

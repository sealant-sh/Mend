// Rename a session in place: one field, save writes the label through
// `POST /sessions/:id/label` (empty clears it back to the auto-namer's turf).

import { useState } from "react";
import { Modal, Pressable, StyleSheet, TextInput, View } from "react-native";

import { EvButton } from "@/components/button";
import { MonoText, UiText } from "@/components/typography";
import { useSessionActions } from "@/data/live";
import { radius, useEvidenceTheme } from "@/theme/evidence";

export interface RenameTarget {
  readonly sessionId: string;
  readonly label: string | null;
}

export function RenameSessionModal({
  target,
  onClose,
}: {
  readonly target: RenameTarget | null;
  readonly onClose: () => void;
}) {
  const { colors } = useEvidenceTheme();
  const { setLabel } = useSessionActions();
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? target?.label ?? "";

  const close = () => {
    setDraft(null);
    setLabel.reset();
    onClose();
  };
  const save = () => {
    if (target === null) return;
    const trimmed = value.trim();
    setLabel.mutate(
      { sessionId: target.sessionId, label: trimmed === "" ? null : trimmed },
      { onSuccess: close },
    );
  };

  return (
    <Modal visible={target !== null} transparent animationType="fade" onRequestClose={close}>
      <Pressable
        onPress={close}
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.35)",
          justifyContent: "flex-start",
          paddingTop: 120,
          paddingHorizontal: 24,
        }}
      >
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={{
            backgroundColor: colors.panel,
            borderRadius: radius.xl2,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.softRule,
            padding: 16,
            gap: 12,
          }}
        >
          <UiText weight="medium">Rename session</UiText>
          <TextInput
            value={value}
            onChangeText={setDraft}
            placeholder="Session label"
            placeholderTextColor={colors.faint}
            autoFocus
            onSubmitEditing={save}
            style={{
              minHeight: 42,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: colors.rule,
              borderRadius: radius.lg,
              paddingHorizontal: 12,
              paddingVertical: 9,
              color: colors.ink,
              backgroundColor: colors.bg,
              fontSize: 15,
            }}
          />
          {setLabel.error instanceof Error && (
            <MonoText tone="danger" size={11} numberOfLines={2}>
              {setLabel.error.message}
            </MonoText>
          )}
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
            <EvButton size="sm" variant="ghost" label="Cancel" onPress={close} />
            <EvButton
              size="sm"
              label={setLabel.isPending ? "Saving…" : "Save"}
              disabled={setLabel.isPending}
              onPress={save}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

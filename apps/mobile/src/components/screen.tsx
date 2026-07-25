// Screen scaffolding: the warm working sheet, generous vertical rhythm, and
// the page-header pattern (eyebrow · display title · one-line mono meta).

import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Eyebrow, DisplayTitle, MonoText } from "@/components/typography";
import { spacing, useEvidenceTheme } from "@/theme/evidence";

export function Screen({
  children,
  topInset = false,
}: {
  readonly children: ReactNode;
  /** Add the status-bar inset — for tab screens that render no native header. */
  readonly topInset?: boolean;
}) {
  const { colors } = useEvidenceTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{
        paddingTop: (topInset ? insets.top : 0) + spacing.md,
        paddingHorizontal: 20,
        paddingBottom: spacing.xl2 + insets.bottom,
        gap: spacing.lg,
      }}
    >
      {children}
    </ScrollView>
  );
}

export function ScreenHeader({
  eyebrow,
  title,
  meta,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly meta?: string;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <DisplayTitle>{title}</DisplayTitle>
      {meta === undefined ? null : (
        <MonoText tone="faint" size={11.5}>
          {meta}
        </MonoText>
      )}
    </View>
  );
}

/** A quiet section label above a panel — eyebrow, spaced, never a container. */
export function SectionLabel({ children }: { readonly children: ReactNode }) {
  return (
    <View style={{ marginBottom: -spacing.sm, paddingHorizontal: 4 }}>
      <Eyebrow>{children}</Eyebrow>
    </View>
  );
}

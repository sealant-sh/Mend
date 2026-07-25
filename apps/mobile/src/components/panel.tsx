// Panels lift off the warm canvas: white, rounded-2xl, resting on a soft
// shadow. Group with space, not borders (DESIGN.md §3, §5).

import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { StyleSheet, View } from "react-native";

import { radius, useEvidenceTheme } from "@/theme/evidence";

export function Panel({
  children,
  lift = false,
  style,
}: {
  readonly children: ReactNode;
  /** The signature cobalt-lift — reserve for the one hero panel. */
  readonly lift?: boolean;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const { colors, shadow } = useEvidenceTheme();
  return (
    <View
      style={[
        {
          backgroundColor: colors.panel,
          borderRadius: radius.xl2,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.softRule,
          boxShadow: lift ? shadow.cobalt : shadow.sm,
          overflow: "hidden",
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** A hairline-divided row inside a panel; the first row draws no rule. */
export function PanelRow({
  children,
  first = false,
  style,
}: {
  readonly children: ReactNode;
  readonly first?: boolean;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useEvidenceTheme();
  return (
    <View
      style={[
        {
          paddingHorizontal: 16,
          paddingVertical: 12,
          ...(first
            ? {}
            : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.faintRule }),
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

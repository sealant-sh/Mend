// Button weight hierarchy (DESIGN.md §5): the one consequential action is
// filled cobalt with the cobalt-lift; cheaper actions stay quiet.

import type { StyleProp, ViewStyle } from "react-native";
import { Pressable } from "react-native";

import { UiText } from "@/components/typography";
import { radius, useEvidenceTheme } from "@/theme/evidence";

export type ButtonVariant = "primary" | "outline" | "ghost";

export function EvButton({
  label,
  variant = "primary",
  onPress,
  style,
}: {
  readonly label: string;
  readonly variant?: ButtonVariant;
  readonly onPress?: () => void;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const { colors, shadow } = useEvidenceTheme();
  const base: ViewStyle = {
    minHeight: 44,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  };
  const byVariant: Record<ButtonVariant, ViewStyle> = {
    primary: { backgroundColor: colors.accent, boxShadow: shadow.cobalt },
    outline: {
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.rule,
      boxShadow: shadow.xs,
    },
    ghost: {},
  };
  const tone = variant === "primary" ? undefined : variant === "outline" ? "ink" : "accent";
  return (
    <Pressable
      {...(onPress ? { onPress } : {})}
      style={({ pressed }) => [base, byVariant[variant], pressed && { opacity: 0.82 }, style]}
    >
      <UiText
        weight="medium"
        size={14}
        {...(tone ? { tone } : {})}
        style={variant === "primary" ? { color: colors.accentForeground } : undefined}
      >
        {label}
      </UiText>
    </Pressable>
  );
}

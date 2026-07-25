// Status is a colored dot plus a word — never a tinted row, never a filled
// pill (DESIGN.md §4). Live activity pulses; everything else is still.

import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { MonoText } from "@/components/typography";
import { useEvidenceTheme } from "@/theme/evidence";

export type StatusTone = "live" | "waiting" | "observed" | "breakage" | "pending";

function Pulse({ color }: { readonly color: string }) {
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(withTiming(0.35, { duration: 900 }), withTiming(1, { duration: 900 })),
      -1,
    );
  }, [opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      style={[{ width: 7, height: 7, borderRadius: 999, backgroundColor: color }, animated]}
    />
  );
}

export function StatusWord({
  tone,
  word,
  size = 11.5,
}: {
  readonly tone: StatusTone;
  readonly word: string;
  readonly size?: number;
}) {
  const { colors } = useEvidenceTheme();
  const dot = {
    live: colors.accent,
    waiting: colors.amber,
    observed: colors.greenDot,
    breakage: colors.red,
    pending: "transparent",
  }[tone];
  const text = {
    live: "accent" as const,
    waiting: "warning" as const,
    observed: "success" as const,
    breakage: "danger" as const,
    pending: "muted" as const,
  }[tone];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      {tone === "live" ? (
        <Pulse color={dot} />
      ) : (
        <View
          style={{
            width: 7,
            height: 7,
            borderRadius: 999,
            backgroundColor: dot,
            ...(tone === "pending" ? { borderWidth: 1.5, borderColor: colors.faint } : {}),
          }}
        />
      )}
      <MonoText tone={text} size={size}>
        {word}
      </MonoText>
    </View>
  );
}

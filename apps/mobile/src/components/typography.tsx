// The three voices (DESIGN.md §2): Space Grotesk for display, Inter for UI,
// JetBrains Mono for everything the recorder observed or executed.

import type { ReactNode } from "react";
import type { StyleProp, TextStyle } from "react-native";
import { Text } from "react-native";

import { useDisplayPreferences } from "@/data/preferences";
import type { EvidenceColors } from "@/theme/evidence";
import { fontFamilies, typeScale, useEvidenceTheme } from "@/theme/evidence";

// Every component below multiplies its size by the user's text scale, so
// the Settings control reaches all type — including callsites that pass an
// explicit `size`. Line heights ride the same multiplier.
export function useTextScale(): number {
  return useDisplayPreferences().textScale;
}

export type Tone =
  | "ink"
  | "ink2"
  | "muted"
  | "label"
  | "faint"
  | "accent"
  | "success"
  | "warning"
  | "danger";

export function toneColor(colors: EvidenceColors, tone: Tone): string {
  switch (tone) {
    case "ink":
      return colors.ink;
    case "ink2":
      return colors.ink2;
    case "muted":
      return colors.muted;
    case "label":
      return colors.label;
    case "faint":
      return colors.faint;
    case "accent":
      return colors.accent;
    case "success":
      return colors.green;
    case "warning":
      return colors.amberText;
    case "danger":
      return colors.redText;
  }
}

interface TextProps {
  readonly children: ReactNode;
  readonly tone?: Tone;
  readonly style?: StyleProp<TextStyle>;
  readonly numberOfLines?: number;
}

/** Display title — Space Grotesk, tight tracking. Page titles only. */
export function DisplayTitle({ children, tone = "ink", style, numberOfLines }: TextProps) {
  const { colors } = useEvidenceTheme();
  const size = typeScale.pageTitle.size * useTextScale();
  return (
    <Text
      {...(numberOfLines === undefined ? {} : { numberOfLines })}
      style={[
        {
          fontFamily: fontFamilies.display.semibold,
          fontSize: size,
          letterSpacing: typeScale.pageTitle.letterSpacing * size,
          lineHeight: size * 1.15,
          color: toneColor(colors, tone),
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** Body prose — Inter 400 at 14.5/1.55. */
export function BodyText({ children, tone = "ink", style, numberOfLines }: TextProps) {
  const { colors } = useEvidenceTheme();
  const size = typeScale.body.size * useTextScale();
  return (
    <Text
      {...(numberOfLines === undefined ? {} : { numberOfLines })}
      style={[
        {
          fontFamily: fontFamilies.sans.regular,
          fontSize: size,
          lineHeight: size * typeScale.body.lineHeight,
          color: toneColor(colors, tone),
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** Interface text — Inter at 13, optionally medium/semibold. */
export function UiText({
  children,
  tone = "ink",
  weight = "regular",
  size = typeScale.ui.size,
  style,
  numberOfLines,
}: TextProps & { readonly weight?: keyof typeof fontFamilies.sans; readonly size?: number }) {
  const { colors } = useEvidenceTheme();
  const scaled = size * useTextScale();
  return (
    <Text
      {...(numberOfLines === undefined ? {} : { numberOfLines })}
      style={[
        {
          fontFamily: fontFamilies.sans[weight],
          fontSize: scaled,
          lineHeight: scaled * 1.4,
          color: toneColor(colors, tone),
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** Machine facts — JetBrains Mono. Values, paths, SHAs, commands, ids. */
export function MonoText({
  children,
  tone = "ink2",
  weight = "regular",
  size = typeScale.mono.size,
  style,
  numberOfLines,
}: TextProps & { readonly weight?: keyof typeof fontFamilies.mono; readonly size?: number }) {
  const { colors } = useEvidenceTheme();
  const scaled = size * useTextScale();
  return (
    <Text
      {...(numberOfLines === undefined ? {} : { numberOfLines })}
      style={[
        {
          fontFamily: fontFamilies.mono[weight],
          fontSize: scaled,
          lineHeight: scaled * 1.5,
          color: toneColor(colors, tone),
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** The tiny mono eyebrow — the only uppercase in the system. */
export function Eyebrow({ children, tone = "label", style }: TextProps) {
  const { colors } = useEvidenceTheme();
  const size = typeScale.eyebrow.size * useTextScale();
  return (
    <Text
      style={[
        {
          fontFamily: fontFamilies.mono.medium,
          fontSize: size,
          letterSpacing: typeScale.eyebrow.letterSpacing * size,
          textTransform: "uppercase",
          color: toneColor(colors, tone),
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

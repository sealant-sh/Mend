// Start a session with its launch tunables: model, thinking effort, and
// priority (codex only — claude's fast mode is an in-session toggle the
// platform doesn't expose at launch). Options persist per harness on device
// and ride the launch request; "default" leaves the harness's own choice.

import { ChevronDown, ChevronRight } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";

import { EvButton } from "@/components/button";
import { PanelRow } from "@/components/panel";
import { MonoText, UiText } from "@/components/typography";
import {
  EFFORT_LEVELS,
  FAST_CAPABLE_HARNESSES,
  HARNESS_MODELS,
  setLaunchOptions,
  useLaunchOptions,
  type LaunchOptions,
} from "@/data/harness-options";
import { PROTOCOL_HARNESSES } from "@/data/live";
import { radius, useEvidenceTheme } from "@/theme/evidence";

function Chip({
  label,
  chosen,
  onPress,
}: {
  readonly label: string;
  readonly chosen: boolean;
  readonly onPress: () => void;
}) {
  const { colors } = useEvidenceTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        borderWidth: 1,
        borderColor: chosen ? colors.accent : colors.rule,
        backgroundColor: chosen ? colors.wash : colors.panel,
        borderRadius: radius.lg,
        paddingHorizontal: 10,
        paddingVertical: 6,
      }}
    >
      <UiText tone={chosen ? "accent" : "ink2"} size={12}>
        {label}
      </UiText>
    </Pressable>
  );
}

function OptionGroup({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <View style={{ gap: 6 }}>
      <MonoText tone="faint" size={10.5}>
        {label}
      </MonoText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{children}</View>
    </View>
  );
}

const summaryOf = (harness: string, options: LaunchOptions): string => {
  const model =
    HARNESS_MODELS[harness]?.find((candidate) => candidate.id === options.model)?.label ??
    options.model ??
    "default model";
  const parts = [model];
  if (options.effort !== null) parts.push(options.effort);
  if (options.speed === "fast") parts.push("fast");
  return parts.join(" · ");
};

function HarnessRow({
  harness,
  first,
  pending,
  onStart,
}: {
  readonly harness: string;
  readonly first: boolean;
  readonly pending: boolean;
  readonly onStart: (harness: string, options: LaunchOptions) => void;
}) {
  const { colors } = useEvidenceTheme();
  const options = useLaunchOptions(harness);
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<LaunchOptions>) =>
    setLaunchOptions(harness, { ...options, ...patch });
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <PanelRow first={first}>
      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Pressable
            onPress={() => setOpen((current) => !current)}
            style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6 }}
          >
            <Chevron size={14} color={colors.faint} strokeWidth={1.8} />
            <View style={{ gap: 2, flexShrink: 1 }}>
              <UiText weight="medium" size={13.5}>
                {harness}
              </UiText>
              <MonoText tone="faint" size={10.5}>
                {summaryOf(harness, options)}
              </MonoText>
            </View>
          </Pressable>
          <EvButton
            size="sm"
            variant="outline"
            label={pending ? "…" : "Start"}
            disabled={pending}
            onPress={() => onStart(harness, options)}
          />
        </View>
        {open && (
          <View style={{ gap: 10 }}>
            <OptionGroup label="model">
              <Chip
                label="default"
                chosen={options.model === null}
                onPress={() => set({ model: null })}
              />
              {(HARNESS_MODELS[harness] ?? []).map((model) => (
                <Chip
                  key={model.id}
                  label={model.label}
                  chosen={options.model === model.id}
                  onPress={() => set({ model: model.id })}
                />
              ))}
            </OptionGroup>
            <OptionGroup label="thinking">
              <Chip
                label="default"
                chosen={options.effort === null}
                onPress={() => set({ effort: null })}
              />
              {EFFORT_LEVELS.map((effort) => (
                <Chip
                  key={effort}
                  label={effort}
                  chosen={options.effort === effort}
                  onPress={() => set({ effort })}
                />
              ))}
            </OptionGroup>
            {FAST_CAPABLE_HARNESSES.has(harness) && (
              <OptionGroup label="priority">
                <Chip
                  label="standard"
                  chosen={options.speed === null}
                  onPress={() => set({ speed: null })}
                />
                <Chip
                  label="fast"
                  chosen={options.speed === "fast"}
                  onPress={() => set({ speed: "fast" })}
                />
              </OptionGroup>
            )}
          </View>
        )}
      </View>
    </PanelRow>
  );
}

/** The harness rows for one project — drop inside a Panel. */
export function StartSessionRows({
  pending,
  onStart,
  first = true,
}: {
  readonly pending: boolean;
  readonly onStart: (harness: string, options: LaunchOptions) => void;
  /** Whether the first harness row is the panel's first row. */
  readonly first?: boolean;
}) {
  return (
    <>
      {PROTOCOL_HARNESSES.map((harness, index) => (
        <HarnessRow
          key={harness}
          harness={harness}
          first={first && index === 0}
          pending={pending}
          onStart={onStart}
        />
      ))}
    </>
  );
}

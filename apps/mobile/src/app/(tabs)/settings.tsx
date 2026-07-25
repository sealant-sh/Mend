// Settings — the machine, its private reachability, and the app itself.
// Remote access should be boring (plan §4.7): show the tailnet facts plainly.

import { View } from "react-native";

import { Panel, PanelRow } from "@/components/panel";
import { Screen, ScreenHeader } from "@/components/screen";
import { StatusWord } from "@/components/status";
import { MonoText, UiText } from "@/components/typography";
import { machine } from "@/data/mock";

function FactRow({
  label,
  value,
  first = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly first?: boolean;
}) {
  return (
    <PanelRow first={first}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <UiText tone="muted">{label}</UiText>
        <MonoText tone="ink2" size={12} numberOfLines={1} style={{ flexShrink: 1 }}>
          {value}
        </MonoText>
      </View>
    </PanelRow>
  );
}

export default function SettingsScreen() {
  return (
    <Screen topInset>
      <ScreenHeader eyebrow="this device" title="Settings" />
      <Panel>
        <PanelRow first>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <UiText weight="semibold" size={15}>
              {machine.name}
            </UiText>
            <StatusWord
              tone={machine.reachable ? "observed" : "breakage"}
              word={machine.reachable ? "Reachable · tailnet" : "Unreachable"}
            />
          </View>
        </PanelRow>
        <FactRow label="Tailnet address" value={machine.tailnet} />
        <FactRow label="Binding" value={machine.binding} />
      </Panel>
      <Panel>
        <FactRow label="Appearance" value="system" first />
        <FactRow label="Version" value="mend 0.0.0 · expo sdk 57" />
        <FactRow label="Design" value="evidence review v3" />
      </Panel>
      <MonoText tone="faint" size={11} style={{ textAlign: "center" }}>
        Paired over a private network. No public ingress.
      </MonoText>
    </Screen>
  );
}

// Settings — the machine this app steers: server URL + the bearer token the
// CLI already uses (MEND_TOKEN). Stored on device; nothing else to set up.

import { useEffect, useState } from "react";
import { TextInput, View } from "react-native";

import { EvButton } from "@/components/button";
import { Panel } from "@/components/panel";
import { Screen, ScreenHeader } from "@/components/screen";
import { MonoText, UiText } from "@/components/typography";
import { loadConfig, saveConfig } from "@/data/live";
import { radius, useEvidenceTheme } from "@/theme/evidence";

export default function SettingsScreen() {
  const { colors } = useEvidenceTheme();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void loadConfig().then((config) => {
      setUrl(config.url);
      setToken(config.token);
    });
  }, []);

  const inputStyle = {
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.ink,
    fontSize: 14,
  };

  return (
    <Screen topInset>
      <ScreenHeader eyebrow="mend" title="Settings" meta="server · token" />
      <Panel>
        <View style={{ padding: 16, gap: 12 }}>
          <UiText>Server URL (reachable from this phone — tailnet or LAN)</UiText>
          <TextInput
            value={url}
            onChangeText={(value) => {
              setUrl(value);
              setSaved(false);
            }}
            placeholder="http://your-machine.tailnet:3105"
            autoCapitalize="none"
            autoCorrect={false}
            style={inputStyle}
          />
          <UiText>Bearer token (same as MEND_TOKEN)</UiText>
          <TextInput
            value={token}
            onChangeText={(value) => {
              setToken(value);
              setSaved(false);
            }}
            placeholder="token"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={inputStyle}
          />
          <EvButton
            label={saved ? "Saved" : "Save"}
            onPress={() => {
              void saveConfig({ url: url.trim().replace(/\/$/, ""), token: token.trim() }).then(
                () => setSaved(true),
              );
            }}
          />
          <MonoText>Sessions, terminal, and review all ride this one connection.</MonoText>
        </View>
      </Panel>
    </Screen>
  );
}

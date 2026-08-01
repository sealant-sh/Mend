// Settings — the machine this app steers: server URL + the bearer token the
// CLI already uses (MEND_TOKEN). Stored on device; nothing else to set up.

import { useEffect, useState } from "react";
import { TextInput, View } from "react-native";

import { EvButton } from "@/components/button";
import { Panel } from "@/components/panel";
import { Screen, ScreenHeader } from "@/components/screen";
import { StatusWord } from "@/components/status";
import { MonoText, UiText } from "@/components/typography";
import { loadConfig, saveConfig } from "@/data/live";
import { enablePushNotifications } from "@/data/notifications";
import { radius, useEvidenceTheme } from "@/theme/evidence";

export default function SettingsScreen() {
  const { colors } = useEvidenceTheme();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [saved, setSaved] = useState(false);
  const [push, setPush] = useState<
    | { readonly state: "idle" }
    | { readonly state: "registering" }
    | { readonly state: "registered" }
    | { readonly state: "unavailable"; readonly reason: string }
  >({ state: "idle" });
  const [check, setCheck] = useState<
    | { readonly state: "idle" }
    | { readonly state: "testing" }
    | { readonly state: "ok"; readonly detail: string }
    | { readonly state: "bad"; readonly detail: string }
  >({ state: "idle" });

  /** Test what's TYPED (not what's saved): health first, then an authed call. */
  const testConnection = async () => {
    setCheck({ state: "testing" });
    const base = url.trim().replace(/\/$/, "");
    try {
      const health = await fetch(`${base}/api/health`);
      if (!health.ok) {
        setCheck({ state: "bad", detail: `server answered ${health.status} on /api/health` });
        return;
      }
      const authed = await fetch(`${base}/api/projects`, {
        headers: { authorization: `Bearer ${token.trim()}` },
      });
      if (authed.status === 401) {
        setCheck({ state: "bad", detail: "reachable · token rejected (401)" });
        return;
      }
      if (!authed.ok) {
        setCheck({ state: "bad", detail: `reachable · projects answered ${authed.status}` });
        return;
      }
      const projects = (await authed.json()) as ReadonlyArray<unknown>;
      setCheck({
        state: "ok",
        detail: `connected · ${projects.length} project${projects.length === 1 ? "" : "s"}`,
      });
    } catch {
      setCheck({ state: "bad", detail: "unreachable — check URL, port, firewall, same network" });
    }
  };

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
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <EvButton
              variant="outline"
              label={check.state === "testing" ? "Testing…" : "Test connection"}
              onPress={() => void testConnection()}
              style={{ flex: 1 }}
            />
            {check.state === "ok" && <StatusWord tone="observed" word="connected" />}
            {check.state === "bad" && <StatusWord tone="breakage" word="failed" />}
          </View>
          {(check.state === "ok" || check.state === "bad") && <MonoText>{check.detail}</MonoText>}
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
      <Panel>
        <View style={{ padding: 16, gap: 12 }}>
          <UiText>Notifications — a push when a session settles or waits on you</UiText>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <EvButton
              variant="outline"
              label={
                push.state === "registering"
                  ? "Registering…"
                  : push.state === "registered"
                    ? "Registered"
                    : "Enable notifications"
              }
              onPress={() => {
                setPush({ state: "registering" });
                void enablePushNotifications().then((result) =>
                  setPush(
                    result.state === "registered"
                      ? { state: "registered" }
                      : { state: "unavailable", reason: result.reason },
                  ),
                );
              }}
              style={{ flex: 1 }}
            />
            {push.state === "registered" && <StatusWord tone="observed" word="registered" />}
            {push.state === "unavailable" && <StatusWord tone="breakage" word="unavailable" />}
          </View>
          {push.state === "unavailable" && <MonoText>{push.reason}</MonoText>}
        </View>
      </Panel>
    </Screen>
  );
}

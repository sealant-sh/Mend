// The full-screen terminal route — t3code's layout recipe: the surface lives
// in a flex-1 container whose bottom padding tracks the LIVE keyboard height
// (the surface shrinks, the PTY resizes, the prompt stays visible), and a
// key bar for what phone keyboards lack (Esc, Tab, Ctrl-C, arrows) rides
// stuck to the top of the keyboard.

import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { KeyboardStickyView, useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GhosttyTerminal } from "@/components/ghostty-terminal";
import { MonoText } from "@/components/typography";
import { loadConfig } from "@/data/live";
import { useEvidenceTheme } from "@/theme/evidence";

const ACCESSORY_HEIGHT = 44;

const KEYS: ReadonlyArray<{ readonly label: string; readonly data: string }> = [
  { label: "esc", data: "\u001b" },
  { label: "tab", data: "\t" },
  { label: "^C", data: "\u0003" },
  { label: "up", data: "\u001b[A" },
  { label: "dn", data: "\u001b[B" },
  { label: "~", data: "~" },
  { label: "|", data: "|" },
  { label: "/", data: "/" },
  { label: "-", data: "-" },
];

export default function TerminalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useEvidenceTheme();
  const insets = useSafeAreaInsets();
  const [base, setBase] = useState<{ url: string; token: string } | null>(null);
  const sendRef = useRef<((data: string) => void) | null>(null);
  useEffect(() => {
    void loadConfig().then((config) => setBase({ url: config.url, token: config.token }));
  }, []);

  const keyboard = useKeyboardState((state) => ({
    height: state.height,
    isVisible: state.isVisible,
  }));
  const bottomInset = keyboard.isVisible ? keyboard.height + ACCESSORY_HEIGHT : insets.bottom;

  return (
    <>
      <Stack.Screen options={{ title: "Terminal" }} />
      <View style={{ flex: 1, backgroundColor: colors.panel, paddingBottom: bottomInset }}>
        {base !== null && id !== undefined && (
          <GhosttyTerminal
            serverUrl={base.url}
            token={base.token}
            sessionId={id}
            registerSend={(send) => {
              sendRef.current = send;
            }}
          />
        )}
      </View>
      {keyboard.isVisible && (
        <KeyboardStickyView
          style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}
          offset={{ closed: 0, opened: 0 }}
        >
          <View
            style={{
              flexDirection: "row",
              height: ACCESSORY_HEIGHT,
              backgroundColor: colors.sunken,
              borderTopWidth: 1,
              borderTopColor: colors.softRule,
            }}
          >
            {KEYS.map((key) => (
              <Pressable
                key={key.label}
                onPress={() => sendRef.current?.(key.data)}
                style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
              >
                <MonoText style={{ color: colors.ink }}>{key.label}</MonoText>
              </Pressable>
            ))}
          </View>
        </KeyboardStickyView>
      )}
    </>
  );
}

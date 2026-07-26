// The native terminal: a libghostty surface (vendored from pingdotgg/t3code,
// MIT — see modules/t3-terminal/THIRD_PARTY_NOTICES.md) fed by the SAME
// /api/tty WebSocket every Mend surface uses. The JS contract is tiny:
// the surface emits input {data} and resize {cols,rows}; remote PTY output
// rides the buffer prop and the native side feeds only the appended suffix.
// When the installed binary lacks the native module (Expo Go, stale build),
// the WebView terminal takes over — the app never loses its terminal.

import { requireNativeView } from "expo";
import type { ComponentType } from "react";
import { useEffect, useRef, useState } from "react";
import type { NativeSyntheticEvent, ViewProps } from "react-native";
import { View } from "react-native";
import { WebView } from "react-native-webview";

import { useEvidenceTheme } from "@/theme/evidence";

interface TerminalInputEvent {
  readonly data: string;
}
interface TerminalResizeEvent {
  readonly cols: number;
  readonly rows: number;
}

interface NativeTerminalSurfaceProps extends ViewProps {
  readonly appearanceScheme?: "light" | "dark";
  readonly autoFocus?: boolean;
  readonly themeConfig?: string;
  readonly backgroundColor?: string;
  readonly foregroundColor?: string;
  readonly terminalKey: string;
  readonly initialBuffer: string;
  readonly fontSize: number;
  readonly onInput?: (event: NativeSyntheticEvent<TerminalInputEvent>) => void;
  readonly onResize?: (event: NativeSyntheticEvent<TerminalResizeEvent>) => void;
}

let cachedView: ComponentType<NativeTerminalSurfaceProps> | null | undefined;
const nativeTerminalView = (): ComponentType<NativeTerminalSurfaceProps> | null => {
  if (cachedView !== undefined) return cachedView;
  try {
    cachedView = requireNativeView<NativeTerminalSurfaceProps>("T3TerminalSurface");
  } catch {
    cachedView = null;
  }
  return cachedView;
};

export function GhosttyTerminal({
  serverUrl,
  token,
  sessionId,
  registerSend,
}: {
  readonly serverUrl: string;
  readonly token: string;
  readonly sessionId: string;
  /** Hands the caller a raw-bytes sender (the accessory key bar uses it). */
  readonly registerSend?: (send: (data: string) => void) => void;
}) {
  const Native = nativeTerminalView();
  const { scheme, colors } = useEvidenceTheme();
  const [buffer, setBuffer] = useState("");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (Native === null) return;
    const url = new URL(`${serverUrl}/api/tty`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("session", sessionId);
    url.searchParams.set("from", "0");
    url.searchParams.set("token", token);
    const ws = new WebSocket(url.toString());
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    registerSend?.((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode(data).buffer as ArrayBuffer);
      }
    });
    const decoder = new TextDecoder();
    ws.onmessage = (event) => {
      if (typeof event.data === "string") return; // control frames ({"t":"end"})
      const chunk = decoder.decode(new Uint8Array(event.data as ArrayBuffer), { stream: true });
      setBuffer((current) => current + chunk);
    };
    return () => {
      wsRef.current = null;
      ws.close();
    };
  }, [Native, serverUrl, token, sessionId]);

  if (Native === null) {
    // Binary without the native module — the WebView terminal still works.
    return (
      <WebView
        source={{
          uri: `${serverUrl}/tty-embed?session=${sessionId}&token=${encodeURIComponent(token)}`,
        }}
        style={{ flex: 1, backgroundColor: colors.panel }}
        keyboardDisplayRequiresUserAction={false}
      />
    );
  }

  const themeConfig = [
    `background = ${colors.panel}`,
    `foreground = ${colors.ink}`,
    `cursor-color = ${colors.accent}`,
    `cursor-text = ${colors.panel}`,
  ].join("\n");

  return (
    <View style={{ flex: 1, backgroundColor: colors.panel }}>
      <Native
        style={{ flex: 1 }}
        terminalKey={sessionId}
        initialBuffer={buffer}
        fontSize={12.5}
        autoFocus
        appearanceScheme={scheme}
        themeConfig={`${themeConfig}\n`}
        backgroundColor={colors.panel}
        foregroundColor={colors.ink}
        onInput={(event) => {
          const socket = wsRef.current;
          if (socket !== null && socket.readyState === WebSocket.OPEN) {
            socket.send(new TextEncoder().encode(event.nativeEvent.data).buffer as ArrayBuffer);
          }
        }}
        onResize={(event) => {
          const socket = wsRef.current;
          if (socket !== null && socket.readyState === WebSocket.OPEN) {
            socket.send(
              JSON.stringify({
                t: "resize",
                cols: event.nativeEvent.cols,
                rows: event.nativeEvent.rows,
              }),
            );
          }
        }}
      />
    </View>
  );
}

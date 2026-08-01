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

// Scrollback the JS side retains. Trimming breaks the native prefix-diff and
// forces a surface reset + full replay, so trim with hysteresis: let the
// buffer run to TRIM_AT, then cut back to KEEP — resets stay rare instead of
// firing on every chunk once the cap is reached (t3code caps at 512 KiB).
const KEEP_CHARS = 512 * 1024;
const TRIM_AT_CHARS = 640 * 1024;

const trimBuffer = (buffer: string): string => {
  if (buffer.length <= TRIM_AT_CHARS) return buffer;
  let start = buffer.length - KEEP_CHARS;
  // Never split a surrogate pair.
  const lead = buffer.charCodeAt(start);
  if (lead >= 0xdc00 && lead <= 0xdfff) start += 1;
  return buffer.slice(start);
};

const decodeLatin1 = (bytes: Uint8Array): string => {
  // Chunked fromCharCode: a spread of a large PTY burst overflows the stack.
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return out;
};

export function GhosttyTerminal({
  serverUrl,
  token,
  sessionId,
  registerSend,
  transformInput,
}: {
  readonly serverUrl: string;
  readonly token: string;
  readonly sessionId: string;
  /** Hands the caller a raw-bytes sender (the accessory key bar uses it). */
  readonly registerSend?: (send: (data: string) => void) => void;
  /** Applied to keyboard input before it hits the wire (sticky modifiers). */
  readonly transformInput?: (data: string) => string;
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
        ws.send(JSON.stringify({ t: "input", data }));
      }
    });
    const decoder = typeof TextDecoder === "undefined" ? null : new TextDecoder();
    // Coalesce PTY bursts to one React commit per frame: a busy harness emits
    // dozens of WebSocket frames per screen frame, and a setState per frame
    // of output is exactly the re-render storm that made the terminal crawl.
    // Chunks accumulate in a ref; one rAF flushes them into state, and the
    // native side feeds only the appended suffix.
    let pending = "";
    let flushHandle: number | null = null;
    const flush = () => {
      flushHandle = null;
      if (pending === "") return;
      const chunk = pending;
      pending = "";
      setBuffer((current) => trimBuffer(current + chunk));
    };
    ws.onmessage = (event) => {
      if (typeof event.data === "string") return; // control frames ({"t":"end"})
      const bytes = new Uint8Array(event.data as ArrayBuffer);
      pending += decoder !== null ? decoder.decode(bytes, { stream: true }) : decodeLatin1(bytes);
      flushHandle ??= requestAnimationFrame(flush);
    };
    return () => {
      wsRef.current = null;
      if (flushHandle !== null) cancelAnimationFrame(flushHandle);
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
            const data = transformInput?.(event.nativeEvent.data) ?? event.nativeEvent.data;
            socket.send(JSON.stringify({ t: "input", data }));
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

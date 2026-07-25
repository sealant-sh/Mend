import { FitAddon, init as initGhostty, Terminal } from "ghostty-web";
import { useEffect, useRef, useState } from "react";

/**
 * The session's real terminal, live in the browser over the same `/api/tty`
 * WebSocket the CLI uses (plan §8.1.F: every device gets the same path).
 * Interactive: keystrokes go up as binary frames, output renders byte-exact
 * with full scrollback replay. Auth is the session cookie riding the
 * same-origin upgrade — nothing else on the wire, nothing per-keystroke.
 *
 * xterm.js is an imperative widget; the effect owns its whole lifecycle
 * (terminal, fit addon, socket, observers) and tears it all down together.
 */

type WireState = "connecting" | "live" | "settled" | "disconnected" | "unavailable";

/** Resolve a CSS custom property so xterm's JS theme follows the app theme. */
const cssVar = (name: string, fallback: string): string => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === "" ? fallback : value;
};

export function SessionTerminal({
  sessionId,
  token,
}: {
  readonly sessionId: string;
  /** Bearer for clients that cannot ride the cookie (the mobile WebView). */
  readonly token?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<WireState>("connecting");

  useEffect(() => {
    const element = containerRef.current;
    if (element === null) return;

    // ghostty-web loads its wasm once; everything below waits on it.
    let cancelled = false;
    let teardown: (() => void) | null = null;
    void initGhostty().then(() => {
      if (cancelled) return;
      teardown = attach();
    });

    const attach = () => {
      const term = new Terminal({
        fontFamily: cssVar("--font-mono", "JetBrains Mono, monospace"),
        fontSize: 12.5,
        lineHeight: 1.4,
        cursorBlink: true,
        scrollback: 10_000,
        theme: {
          background: cssVar("--sw-panel", "#ffffff"),
          foreground: cssVar("--sw-ink", "#1b1b1d"),
          cursor: cssVar("--sw-accent", "#2052cc"),
          cursorAccent: cssVar("--sw-panel", "#ffffff"),
          selectionBackground: "rgba(32, 82, 204, 0.18)",
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(element);
      fit.fit();

      const url = new URL("/api/tty", window.location.origin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("session", sessionId);
      url.searchParams.set("from", "0");
      if (token !== undefined && token !== "") url.searchParams.set("token", token);
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";

      const sendResize = () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ t: "resize", cols: term.cols, rows: term.rows }));
        }
      };

      let settled = false;
      ws.addEventListener("open", () => {
        setState("live");
        sendResize();
        term.focus();
      });
      ws.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          try {
            const frame = JSON.parse(event.data) as { readonly t?: string };
            if (frame.t === "end") {
              settled = true;
              setState("settled");
            }
          } catch {
            // Unknown text frame — ignore.
          }
          return;
        }
        term.write(new Uint8Array(event.data as ArrayBuffer));
      });
      ws.addEventListener("close", () => {
        setState((current) => {
          if (settled || current === "settled") return "settled";
          return current === "connecting" ? "unavailable" : "disconnected";
        });
      });

      const encoder = new TextEncoder();
      const onData = term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(new Uint8Array(encoder.encode(data)).buffer);
        }
      });
      const onResize = term.onResize(() => sendResize());
      const observer = new ResizeObserver(() => fit.fit());
      observer.observe(element);

      return () => {
        observer.disconnect();
        onData.dispose();
        onResize.dispose();
        ws.close();
        term.dispose();
      };
    };

    return () => {
      cancelled = true;
      teardown?.();
    };
  }, [sessionId]);

  return (
    <div>
      <div ref={containerRef} className="h-[480px] w-full px-3 py-2" />
      {state !== "live" && (
        <p className="border-t border-rule-faint px-4 py-2 font-mono text-[11.5px] text-faint">
          {state === "connecting" && "connecting…"}
          {state === "settled" && "session settled — the terminal is closed; the record remains"}
          {state === "disconnected" && "connection dropped — reload to reattach"}
          {state === "unavailable" && "terminal unavailable — the session has no live PTY"}
        </p>
      )}
    </div>
  );
}

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

type WireState = "connecting" | "live" | "reconnecting" | "settled";

// The reconnect discipline mirrors the mobile tty hook (patterns from
// t3code's connection supervisor, MIT — pingdotgg/t3code): a fixed ladder,
// reset once the link proves stable, immediate retry on window focus. The
// terminal instance survives reconnects — only the socket is replaced, and
// the screen resets because the server replays the record from 0.
const LADDER_MS = [3_000, 4_000, 8_000, 16_000] as const;
const STABLE_AFTER_MS = 30_000;

/** Resolve a CSS custom property so xterm's JS theme follows the app theme. */
const cssVar = (name: string, fallback: string): string => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === "" ? fallback : value;
};

export function SessionTerminal({
  sessionId,
  processId,
  token,
}: {
  readonly sessionId: string;
  /** A supporting shell process. Omitted for the session's agent PTY. */
  readonly processId?: string;
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
      if (cancelled) return null;
      teardown = attach();
      return null;
    });

    const attach = () => {
      const term = new Terminal({
        fontFamily: cssVar("--font-mono", "JetBrains Mono, monospace"),
        fontSize: 12.5,
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

      let ws: WebSocket | null = null;
      let timer: number | null = null;
      let attempt = 0;
      let connectedAt: number | null = null;
      let settled = false;
      let disposed = false;

      const sendResize = () => {
        if (ws !== null && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ t: "resize", cols: term.cols, rows: term.rows }));
        }
      };

      const connect = () => {
        if (disposed || settled) return;
        setState(attempt === 0 ? "connecting" : "reconnecting");
        const url = new URL("/api/tty", window.location.origin);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set(
          processId === undefined ? "session" : "process",
          processId ?? sessionId,
        );
        url.searchParams.set("from", "0");
        if (token !== undefined && token !== "") url.searchParams.set("token", token);
        const socket = new WebSocket(url);
        socket.binaryType = "arraybuffer";
        ws = socket;

        socket.addEventListener("open", () => {
          if (disposed || socket !== ws) return;
          connectedAt = Date.now();
          // The server replays from 0 — the screen is replaced, not appended.
          term.reset();
          setState("live");
          sendResize();
          term.focus();
        });
        socket.addEventListener("message", (event) => {
          if (disposed || socket !== ws) return;
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
        socket.addEventListener("close", () => {
          if (disposed || socket !== ws) return;
          ws = null;
          if (settled) {
            setState("settled");
            return;
          }
          if (connectedAt !== null && Date.now() - connectedAt >= STABLE_AFTER_MS) attempt = 0;
          connectedAt = null;
          const delay = LADDER_MS[Math.min(attempt, LADDER_MS.length - 1)];
          attempt += 1;
          setState("reconnecting");
          timer = window.setTimeout(connect, delay);
        });
      };

      // Coming back to the tab is the moment the user notices a dead link:
      // skip whatever backoff remains and try immediately.
      const onFocus = () => {
        if (disposed || settled) return;
        if (ws !== null && ws.readyState === WebSocket.OPEN) return;
        if (timer !== null) {
          window.clearTimeout(timer);
          timer = null;
        }
        attempt = 0;
        connect();
      };
      window.addEventListener("focus", onFocus);

      const encoder = new TextEncoder();
      const onData = term.onData((data) => {
        if (ws !== null && ws.readyState === WebSocket.OPEN) {
          ws.send(new Uint8Array(encoder.encode(data)).buffer);
        }
      });
      const onResize = term.onResize(() => sendResize());
      const observer = new ResizeObserver(() => fit.fit());
      observer.observe(element);
      connect();

      return () => {
        disposed = true;
        window.removeEventListener("focus", onFocus);
        if (timer !== null) window.clearTimeout(timer);
        observer.disconnect();
        onData.dispose();
        onResize.dispose();
        ws?.close();
        term.dispose();
      };
    };

    return () => {
      cancelled = true;
      teardown?.();
    };
  }, [sessionId, processId, token]);

  return (
    <div>
      <div ref={containerRef} className="h-[480px] w-full px-3 py-2" />
      {state !== "live" && (
        <p className="border-t border-rule-faint px-4 py-2 font-mono text-[11.5px] text-faint">
          {state === "connecting" && "connecting…"}
          {state === "settled" && "session settled — the terminal is closed; the record remains"}
          {state === "reconnecting" && "connection lost — reconnecting automatically"}
        </p>
      )}
    </div>
  );
}

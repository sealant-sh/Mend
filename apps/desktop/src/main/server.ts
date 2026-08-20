import type {
  ApiRequest,
  ApiResponse,
  EventsState,
  SignInInput,
  SignInResult,
  TtyTarget,
  WorkbenchEvent,
} from "../shared/bridge";
import { loadConfig, saveConfig } from "./config";

/**
 * Main's side of the wire: plain fetch with the bearer, the same shapes the
 * CLI sends. Nothing here knows what a session is — the renderer owns the
 * product model; this module owns the credential.
 */

const normalizeUrl = (url: string): string => url.trim().replace(/\/+$/, "");

export const request = async (input: ApiRequest): Promise<ApiResponse> => {
  const config = loadConfig();
  if (config.token === null) return { status: 401, ok: false, body: null };
  const headers: Record<string, string> = { authorization: `Bearer ${config.token}` };
  if (input.body !== undefined) headers["content-type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(`${normalizeUrl(config.url)}${input.path}`, {
      method: input.method,
      headers,
      ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
    });
  } catch (error) {
    // Status 0: the server did not answer at all — distinct from it saying no.
    return {
      status: 0,
      ok: false,
      body: error instanceof Error ? error.message : String(error),
    };
  }
  const text = await response.text();
  let body: unknown = text === "" ? null : text;
  const contentType = response.headers.get("content-type") ?? "";
  if (text !== "" && contentType.includes("application/json")) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, ok: response.ok, body };
};

/**
 * Email + password against better-auth's sign-in route; the bearer plugin
 * answers with `set-auth-token`. Saved to the shared credential file, so the
 * CLI is signed in too.
 */
export const signIn = async (input: SignInInput): Promise<SignInResult> => {
  const url = normalizeUrl(input.url);
  if (url === "") return { ok: false, reason: "a server URL is required" };
  let response: Response;
  try {
    response = await fetch(`${url}/api/auth/sign-in/email`, {
      method: "POST",
      // better-auth's CSRF check rejects the `Origin: null` a non-browser fetch
      // sends; the server's own URL is always a trusted origin, so present that.
      headers: { "content-type": "application/json", origin: url },
      body: JSON.stringify({ email: input.email, password: input.password }),
    });
  } catch {
    return { ok: false, reason: `cannot reach the Mend server at ${url} — is it running?` };
  }
  if (response.status === 400 || response.status === 401 || response.status === 403) {
    return { ok: false, reason: `sign-in refused for ${input.email} at ${url}` };
  }
  if (!response.ok) {
    return { ok: false, reason: `sign-in failed: ${url} responded ${response.status}` };
  }
  const token = response.headers.get("set-auth-token");
  if (token === null || token === "") {
    return {
      ok: false,
      reason: "the server signed you in but returned no bearer token (bearer plugin missing?)",
    };
  }
  saveConfig({ url, token });
  return { ok: true, url };
};

export const setToken = (input: { readonly url: string; readonly token: string }): void => {
  saveConfig({ url: normalizeUrl(input.url), token: input.token.trim() });
};

export const signOut = (): void => {
  const config = loadConfig();
  saveConfig({ url: config.url, token: null });
};

/** The `/api/tty` address the CLI uses — bearer as `?token=` (WebSocket cannot set headers). */
export const ttyUrl = (target: TtyTarget, from: string): string => {
  const config = loadConfig();
  const url = new URL(`${normalizeUrl(config.url)}/api/tty`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set(target.kind, target.id);
  url.searchParams.set("from", from);
  if (config.token !== null) url.searchParams.set("token", config.token);
  return url.toString();
};

// ─── /api/events — one held SSE read, relayed to the window ─────────────────

const LADDER_MS = [3_000, 4_000, 8_000, 16_000] as const;
const STABLE_AFTER_MS = 30_000;

export interface EventsSink {
  readonly onEvent: (event: WorkbenchEvent) => void;
  readonly onState: (state: EventsState) => void;
}

/**
 * Reads the server's event stream with the bearer (EventSource cannot carry a
 * header) and parses SSE by hand: `data:` lines per event, blank line ends it,
 * `:` lines are heartbeats. Reconnects on the CLI's ladder; a 401 stops and
 * reports `unauthorized` — the credential changed, not the network.
 */
export const subscribeEvents = (sink: EventsSink): (() => void) => {
  let disposed = false;
  let controller: AbortController | null = null;
  let timer: NodeJS.Timeout | null = null;
  let attempt = 0;

  const schedule = () => {
    if (disposed) return;
    const delay = LADDER_MS[Math.min(attempt, LADDER_MS.length - 1)];
    attempt += 1;
    sink.onState("reconnecting");
    timer = setTimeout(() => void connect(), delay);
  };

  const connect = async () => {
    if (disposed) return;
    const config = loadConfig();
    if (config.token === null) {
      sink.onState("off");
      return;
    }
    sink.onState(attempt === 0 ? "connecting" : "reconnecting");
    const abort = new AbortController();
    controller = abort;
    const openedAt = Date.now();
    try {
      const response = await fetch(`${normalizeUrl(config.url)}/api/events`, {
        headers: { authorization: `Bearer ${config.token}`, accept: "text/event-stream" },
        signal: abort.signal,
      });
      if (response.status === 401) {
        sink.onState("unauthorized");
        return;
      }
      if (!response.ok || response.body === null) {
        schedule();
        return;
      }
      sink.onState("live");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let data: Array<string> = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
          const line = buffer.slice(0, newline).replace(/\r$/, "");
          buffer = buffer.slice(newline + 1);
          if (line === "") {
            if (data.length > 0) {
              try {
                const parsed: unknown = JSON.parse(data.join("\n"));
                if (typeof parsed === "object" && parsed !== null && "type" in parsed) {
                  sink.onEvent(parsed as WorkbenchEvent);
                }
              } catch {
                // A malformed line is dropped; the next event is independent.
              }
              data = [];
            }
          } else if (line.startsWith("data:")) {
            data.push(line.slice(5).replace(/^ /, ""));
          }
          newline = buffer.indexOf("\n");
        }
      }
    } catch {
      // Aborted (dispose/restart) or the link dropped — both fall through.
    }
    if (disposed || controller !== abort) return;
    if (Date.now() - openedAt >= STABLE_AFTER_MS) attempt = 0;
    schedule();
  };

  void connect();

  return () => {
    disposed = true;
    if (timer !== null) clearTimeout(timer);
    controller?.abort();
  };
};

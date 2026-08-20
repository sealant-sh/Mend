/**
 * The contract between the renderer and the main process — the ONLY way the
 * page reaches the Mend server. Main holds the server URL and the bearer
 * (the same `cli.json` that `mend login` writes, so one sign-in serves the
 * CLI and the desktop); the renderer asks for requests by path, never by URL.
 *
 * HTTP rides IPC (Node's fetch has no CORS to negotiate). The workbench event
 * stream is read in main and relayed as `onEvent`. The terminal is the one
 * held duplex the renderer opens itself: a WebSocket to `/api/tty`, the same
 * data plane the CLI uses, with the bearer folded into `?token=` by main.
 */

export interface ConnectionInfo {
  /** Server base URL, e.g. http://localhost:3105. Empty when unconfigured. */
  readonly url: string;
  /** Whether a bearer is on file — never the bearer itself. */
  readonly signedIn: boolean;
  /** Where the credential lives, for the connect screen to name it. */
  readonly configPath: string;
}

export interface ApiRequest {
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: string;
  readonly body?: unknown;
}

export interface ApiResponse {
  readonly status: number;
  readonly ok: boolean;
  /** JSON when the server sent JSON; raw text otherwise; null on empty. */
  readonly body: unknown;
}

export interface SignInInput {
  readonly url: string;
  readonly email: string;
  readonly password: string;
}

export type SignInResult =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: string };

/** One line from `/api/events` (plan §9.4 — payloads are pointers). */
export interface WorkbenchEvent {
  readonly type: string;
  readonly projectId?: string;
  readonly sessionId?: string;
  readonly changeId?: string;
  readonly sequence?: string;
  readonly line?: string;
}

export type EventsState = "connecting" | "live" | "reconnecting" | "unauthorized" | "off";

export type TtyTarget =
  | { readonly kind: "session"; readonly id: string }
  | { readonly kind: "process"; readonly id: string };

export interface MendBridge {
  readonly platform: "darwin" | "linux" | "win32";
  readonly connection: {
    readonly get: () => Promise<ConnectionInfo>;
    readonly signIn: (input: SignInInput) => Promise<SignInResult>;
    readonly setToken: (input: { readonly url: string; readonly token: string }) => Promise<void>;
    readonly signOut: () => Promise<void>;
    /** Fires after any change to the connection (sign-in, sign-out, file edit). */
    readonly onChange: (listener: (info: ConnectionInfo) => void) => () => void;
  };
  readonly api: {
    readonly request: (input: ApiRequest) => Promise<ApiResponse>;
  };
  readonly tty: {
    /** A ready-to-open WebSocket URL for the target, replaying from `from`. */
    readonly url: (target: TtyTarget, from: string) => Promise<string>;
  };
  readonly events: {
    readonly onEvent: (listener: (event: WorkbenchEvent) => void) => () => void;
    readonly onState: (listener: (state: EventsState) => void) => () => void;
  };
  readonly shell: {
    readonly openExternal: (url: string) => Promise<void>;
  };
  readonly window: {
    readonly minimize: () => void;
    readonly toggleMaximize: () => void;
    readonly close: () => void;
  };
}

export const IPC = {
  connectionGet: "mend:connection:get",
  connectionSignIn: "mend:connection:sign-in",
  connectionSetToken: "mend:connection:set-token",
  connectionSignOut: "mend:connection:sign-out",
  connectionChanged: "mend:connection:changed",
  apiRequest: "mend:api:request",
  ttyUrl: "mend:tty:url",
  event: "mend:events:event",
  eventsState: "mend:events:state",
  openExternal: "mend:shell:open-external",
  windowMinimize: "mend:window:minimize",
  windowToggleMaximize: "mend:window:toggle-maximize",
  windowClose: "mend:window:close",
} as const;

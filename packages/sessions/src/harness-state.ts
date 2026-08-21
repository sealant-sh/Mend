/**
 * The harness session store (plan §5/§7): every settled session's RAW native
 * harness state — conversation transcripts, todo state, rollouts — harvested
 * out of the workspace into the central store, automatically. Nothing here is
 * user-facing: harvest fires at settle, restore + native resume fire at
 * relaunch, and the transcript adapters below are the harness-agnostic seam
 * (text is the interchange format — native state never crosses harnesses).
 *
 * Harness state belongs to one AGENT PROCESS, not to the session: a session
 * holds several agent processes over its life (relaunch, follow-up, resume)
 * and each leaves its own capture. Layout under
 * `~/.config/mend/store/<project>/sessions/<session-id>/processes/<process-id>/`:
 *   harness-state.tar.gz   the raw `$HOME` state dirs, exactly as the harness wrote them
 *   transcript.native      the primary conversation file (claude/codex: JSONL)
 *   manifest.json          { harness, providerSessionId, capturedAt }
 *
 * Sessions harvested before 2026-08-21 kept the same three files at the
 * session root; `locateHarnessState` reads those when no process capture
 * exists. Nothing migrates the tarballs.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Effect, Schema } from "effect";

export const HarnessStateManifest = Schema.Struct({
  harness: Schema.String,
  /** The harness's OWN session id — what a native resume addresses. */
  providerSessionId: Schema.NullOr(Schema.String),
  capturedAt: Schema.String,
});
export type HarnessStateManifest = typeof HarnessStateManifest.Type;

export class HarnessStateNotFoundError extends Schema.TaggedErrorClass<HarnessStateNotFoundError>()(
  "HarnessStateNotFoundError",
  {
    sessionId: Schema.String,
    path: Schema.String,
    message: Schema.String,
  },
) {}

export class HarnessStateIOError extends Schema.TaggedErrorClass<HarnessStateIOError>()(
  "HarnessStateIOError",
  {
    sessionId: Schema.String,
    operation: Schema.Literals([
      "read-manifest",
      "clear-manifest",
      "write-archive",
      "write-transcript",
      "write-canonical",
      "write-manifest",
      "stage-archive",
      "read-transcript",
      "stage-import",
    ]),
    path: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class HarnessStateInvalidError extends Schema.TaggedErrorClass<HarnessStateInvalidError>()(
  "HarnessStateInvalidError",
  {
    sessionId: Schema.String,
    path: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class HarnessStateCommandError extends Schema.TaggedErrorClass<HarnessStateCommandError>()(
  "HarnessStateCommandError",
  {
    sessionId: Schema.String,
    harness: Schema.String,
    operation: Schema.Literals([
      "capture-archive",
      "locate-transcript",
      "read-transcript",
      "identify-session",
      "restore-archive",
      "import-session",
    ]),
    exitCode: Schema.Number,
    stderr: Schema.String,
    message: Schema.String,
  },
) {}

export type HarnessStateError =
  | HarnessStateNotFoundError
  | HarnessStateIOError
  | HarnessStateInvalidError
  | HarnessStateCommandError;

const isMissingFile = (cause: unknown): boolean =>
  typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";

/** Read and validate the commit marker for a harvested harness session. */
export const readHarnessStateManifest = (stateDir: string, sessionId: string) => {
  const manifestPath = path.join(stateDir, "manifest.json");
  return Effect.tryPromise({
    try: () => fs.readFile(manifestPath, "utf8"),
    catch: (cause) =>
      isMissingFile(cause)
        ? new HarnessStateNotFoundError({
            sessionId,
            path: manifestPath,
            message: `Saved harness state is missing for session ${sessionId}.`,
          })
        : new HarnessStateIOError({
            sessionId,
            operation: "read-manifest",
            path: manifestPath,
            message: `Could not read the saved harness-state manifest for session ${sessionId}.`,
            cause,
          }),
  }).pipe(
    Effect.flatMap((raw) =>
      Schema.decodeUnknownEffect(Schema.fromJsonString(HarnessStateManifest))(raw).pipe(
        Effect.mapError(
          (cause) =>
            new HarnessStateInvalidError({
              sessionId,
              path: manifestPath,
              message: `Saved harness state is invalid for session ${sessionId}.`,
              cause,
            }),
        ),
      ),
    ),
  );
};

/** A harvested capture: the directory holding the three files, and its commit marker. */
export interface LocatedHarnessState {
  readonly stateDir: string;
  readonly manifest: HarnessStateManifest;
}

/**
 * The session-level "latest" view over per-process captures: the newest agent
 * process with a committed manifest wins; the legacy session-root capture is
 * the last resort. `processStateDirs` is newest first. Fails with
 * `HarnessStateNotFoundError` (naming the session root) when nothing exists.
 */
export const locateHarnessState = (
  sessionStateDir: string,
  processStateDirs: ReadonlyArray<string>,
  sessionId: string,
): Effect.Effect<
  LocatedHarnessState,
  HarnessStateNotFoundError | HarnessStateIOError | HarnessStateInvalidError
> =>
  Effect.gen(function* () {
    for (const stateDir of processStateDirs) {
      const manifest = yield* readHarnessStateManifest(stateDir, sessionId).pipe(
        Effect.catchTag("HarnessStateNotFoundError", () => Effect.succeed(null)),
      );
      if (manifest !== null) return { stateDir, manifest };
    }
    const manifest = yield* readHarnessStateManifest(sessionStateDir, sessionId);
    return { stateDir: sessionStateDir, manifest };
  });

interface HarnessStateShape {
  /** `$HOME`-relative directories/files that hold the harness's session state. */
  readonly paths: ReadonlyArray<string>;
  /** Shell snippet printing the path of the primary transcript file, newest first. */
  readonly latestTranscript: string;
  /** Derive the provider session id from the primary transcript's path/name. */
  readonly providerSessionId: (transcriptPath: string) => string | null;
}

const CLAUDE_JSONL = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;
const CODEX_ROLLOUT =
  /rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;

export const HARNESS_STATE: Record<string, HarnessStateShape> = {
  claude: {
    paths: [
      ".claude/projects",
      ".claude/todos",
      ".claude/sessions",
      ".claude/settings.json",
      ".claude.json",
    ],
    latestTranscript: 'ls -t "$HOME"/.claude/projects/*/*.jsonl 2>/dev/null | head -1',
    providerSessionId: (file) => CLAUDE_JSONL.exec(file)?.[1] ?? null,
  },
  codex: {
    paths: [".codex/sessions", ".codex/history.jsonl"],
    latestTranscript: 'ls -t "$HOME"/.codex/sessions/*/*/*/rollout-*.jsonl 2>/dev/null | head -1',
    providerSessionId: (file) => CODEX_ROLLOUT.exec(file)?.[1] ?? null,
  },
  opencode: {
    paths: [".local/share/opencode"],
    latestTranscript: "true",
    providerSessionId: () => null,
  },
};

/** Turn a normal harness launch into that harness's native session resume. */
export const nativeResumeArgv = (
  harness: string,
  providerSessionId: string | null,
  argv: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  if (providerSessionId === null) return argv;
  switch (harness) {
    case "claude": {
      if (
        argv[0] !== "claude" ||
        argv.includes("--resume") ||
        argv.includes("-r") ||
        argv.includes("--continue")
      ) {
        return argv;
      }
      const [, ...tail] = argv;
      return ["claude", "--resume", providerSessionId, ...tail];
    }
    case "codex": {
      if (argv[0] !== "codex" || argv[1] === "resume") return argv;
      const [, ...tail] = argv;
      return ["codex", "resume", providerSessionId, ...tail];
    }
    default:
      return argv;
  }
};

// ---------------------------------------------------------------------------
// Transcript adapters — native session files → one normalized shape. This is
// the seam that makes a saved session openable anywhere: a target harness
// never reads another harness's state, it reads the distilled conversation.
// ---------------------------------------------------------------------------

export interface TranscriptTurn {
  readonly role: "user" | "assistant";
  readonly text: string;
}

const textOfContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const p = part as { readonly type?: string; readonly text?: string };
        return p.type === "text" && typeof p.text === "string" ? p.text : "";
      })
      .filter((text) => text !== "")
      .join("\n");
  }
  return "";
};

/** Claude Code session JSONL: `{type: "user"|"assistant", message: {role, content}}` lines. */
const parseClaudeTranscript = (jsonl: string): ReadonlyArray<TranscriptTurn> => {
  const turns: TranscriptTurn[] = [];
  for (const line of jsonl.split("\n")) {
    if (line.trim() === "") continue;
    let entry: {
      readonly type?: string;
      readonly message?: { readonly role?: string; readonly content?: unknown };
      readonly isMeta?: boolean;
    };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      continue;
    }
    if (entry.isMeta === true) continue;
    if (entry.type !== "user" && entry.type !== "assistant") continue;
    const text = textOfContent(entry.message?.content).trim();
    if (text === "") continue;
    turns.push({ role: entry.type, text });
  }
  return turns;
};

/** Codex rollout JSONL: `{type: "response_item", payload: {type: "message", role, content}}` lines. */
const parseCodexTranscript = (jsonl: string): ReadonlyArray<TranscriptTurn> => {
  const turns: TranscriptTurn[] = [];
  for (const line of jsonl.split("\n")) {
    if (line.trim() === "") continue;
    let entry: {
      readonly type?: string;
      readonly payload?: {
        readonly type?: string;
        readonly role?: string;
        readonly content?: unknown;
      };
    };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      continue;
    }
    if (entry.type !== "response_item" || entry.payload?.type !== "message") continue;
    const role = entry.payload.role;
    if (role !== "user" && role !== "assistant") continue;
    const text = textOfContent(entry.payload.content).trim();
    if (text === "") continue;
    turns.push({ role, text });
  }
  return turns;
};

/** Parse a saved native transcript into normalized turns. Unknown harness → empty. */
export const extractTranscript = (
  harness: string,
  native: string,
): ReadonlyArray<TranscriptTurn> => {
  switch (harness) {
    case "claude":
      return parseClaudeTranscript(native);
    case "codex":
      return parseCodexTranscript(native);
    default:
      return [];
  }
};

const TURN_LIMIT = 40;
const TURN_CHARS = 2_000;

/**
 * Distill a transcript into the opening prompt a DIFFERENT harness receives —
 * the cross-harness open. Mechanical, no inference: recent turns verbatim
 * (truncated per turn), oldest elided with an honest marker.
 */
export const distillOpeningPrompt = (
  sourceHarness: string,
  turns: ReadonlyArray<TranscriptTurn>,
): string => {
  const recent = turns.slice(-TURN_LIMIT);
  const elided = turns.length - recent.length;
  const body = recent
    .map((turn) => {
      const text =
        turn.text.length > TURN_CHARS
          ? `${turn.text.slice(0, TURN_CHARS)}\n[…truncated]`
          : turn.text;
      return `${turn.role === "user" ? "User" : "Assistant"}:\n${text}`;
    })
    .join("\n\n");
  return [
    `You are resuming a coding session that was previously driven by ${sourceHarness}.`,
    `The working tree already contains that session's work — read it before changing anything.`,
    elided > 0 ? `(${elided} earlier turns elided.)` : null,
    ``,
    `Conversation so far:`,
    ``,
    body,
    ``,
    `Continue from where the conversation left off.`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
};

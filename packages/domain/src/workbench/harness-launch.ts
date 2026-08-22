/**
 * Structured session start → harness argv, composed in exactly one place.
 *
 * The composer (web), the CLI, and any future surface describe a start as
 * { prompt, model, effort, permissionMode }; the launch handler turns that
 * into the harness's own flags here. Clients never build harness argv for
 * the composed path — the published CLI stays dependency-free and passes
 * strings through, validated by the API contract.
 */

/**
 * Thinking depth, one shared scale; each harness maps it to its own flag.
 * Both harnesses accept all five (claude `--effort`, codex
 * `model_reasoning_effort` — its extra codex-only `ultra` tier is not
 * offered here).
 */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/**
 * Priority processing. `fast` maps to codex `service_tier=priority`
 * ("1.5x speed, increased usage" per `codex debug models`); claude has no
 * launch-time flag for fast mode (it is the in-session `/fast` toggle), so
 * only harnesses in FAST_CAPABLE_HARNESSES surface the control.
 */
export const SPEED_MODES = ["standard", "fast"] as const;
export type SpeedMode = (typeof SPEED_MODES)[number];

/** Harnesses whose composed argv can request priority processing. */
export const FAST_CAPABLE_HARNESSES: ReadonlySet<string> = new Set(["codex"]);

/**
 * `bypass` (and absent) is today's behavior: the engine's
 * `withPermissionDefaults` injects the harness's bypass flag. `ask` opts back
 * into the harness's ordinary approval prompts — the composed argv names a
 * permission flag itself, which suppresses the engine's injection.
 */
export const PERMISSION_MODES = ["bypass", "ask"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** A picker suggestion — `id` is what the harness CLI accepts verbatim. */
export interface HarnessModelOption {
  readonly id: string;
  readonly label: string;
  readonly isDefault: boolean;
}

/**
 * Advisory catalogs for model pickers; the contract keeps `model` free-form
 * because harnesses accept ids these lists don't know yet. The claude default
 * mirrors the engine's onboarding seed (`CLAUDE_ONBOARDING_SEED`); the codex
 * list comes from `codex debug models` (the CLI's own catalog, minus internal
 * entries), with the user's config default first.
 */
export const HARNESS_MODELS: Record<string, ReadonlyArray<HarnessModelOption>> = {
  claude: [
    { id: "claude-fable-5", label: "Fable 5", isDefault: true },
    { id: "claude-opus-5", label: "Opus 5", isDefault: false },
    { id: "claude-opus-4-8", label: "Opus 4.8", isDefault: false },
    { id: "claude-sonnet-5", label: "Sonnet 5", isDefault: false },
  ],
  codex: [
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", isDefault: true },
    { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", isDefault: false },
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", isDefault: false },
    { id: "gpt-5.5", label: "GPT-5.5", isDefault: false },
    { id: "gpt-5.4", label: "GPT-5.4", isDefault: false },
  ],
};

/** Harnesses whose composed argv actually carries an opening prompt. */
export const PROMPTABLE_HARNESSES: ReadonlySet<string> = new Set(["claude", "codex", "opencode"]);

/** A structured start; every field optional — all-absent composes the bare harness. */
export interface LaunchStart {
  readonly mode?: "pty" | "protocol" | undefined;
  readonly prompt?: string | undefined;
  readonly model?: string | undefined;
  readonly effort?: EffortLevel | undefined;
  readonly permissionMode?: PermissionMode | undefined;
  readonly speed?: SpeedMode | undefined;
}

const trimmed = (value: string | undefined): string | null => {
  const body = value?.trim() ?? "";
  return body === "" ? null : body;
};

/**
 * Compose the PTY argv for a structured start. The prompt rides as the last
 * positional (the harness opens with it as the first user message); permission
 * `bypass`/absent emits nothing so the engine's `withPermissionDefaults`
 * injects the bypass flag exactly as for a bare launch.
 */
export const composeLaunchArgv = (harness: string, start: LaunchStart): ReadonlyArray<string> => {
  const prompt = trimmed(start.prompt);
  const model = trimmed(start.model);
  switch (harness) {
    case "claude": {
      const argv = ["claude"];
      if (model !== null) argv.push("--model", model);
      if (start.effort !== undefined) argv.push("--effort", start.effort);
      if (start.permissionMode === "ask") argv.push("--permission-mode", "auto");
      if (prompt !== null) argv.push(prompt);
      return argv;
    }
    case "codex": {
      const argv = ["codex"];
      if (model !== null) argv.push("--model", model);
      if (start.effort !== undefined) argv.push("-c", `model_reasoning_effort=${start.effort}`);
      // Priority processing; codex warns and omits the tier when the model
      // doesn't advertise it, so this degrades harmlessly.
      if (start.speed === "fast") argv.push("-c", "service_tier=priority");
      // The container is the real sandbox; `ask` only restores approval
      // prompts. Naming `--sandbox` suppresses the engine's bypass injection.
      if (start.permissionMode === "ask")
        argv.push("--sandbox", "danger-full-access", "--ask-for-approval", "on-request");
      if (prompt !== null) argv.push(prompt);
      return argv;
    }
    case "opencode":
      return prompt === null ? ["opencode"] : ["opencode", "run", prompt];
    case "shell":
      return ["bash"];
    default:
      return [harness];
  }
};

/** A harness has no supported structured byte protocol in Mend. */
export class ProtocolHarnessUnsupportedError extends Error {
  readonly _tag = "ProtocolHarnessUnsupportedError" as const;
  readonly harness: string;

  constructor(harness: string) {
    super(`Harness "${harness}" does not support protocol mode.`);
    this.harness = harness;
  }
}

/** Compose the long-lived protocol process argv. Model and effort stay on provider turns. */
export const composeProtocolArgv = (
  harness: string,
  start: LaunchStart,
  providerSessionId?: string,
): ReadonlyArray<string> | ProtocolHarnessUnsupportedError => {
  const model = trimmed(start.model);
  switch (harness) {
    case "codex":
      return ["codex", "app-server"];
    case "claude": {
      const argv = [
        "claude",
        "--print",
        "--verbose",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
        "--permission-prompt-tool",
        "stdio",
      ];
      if (providerSessionId === undefined) argv.push("--session-id", crypto.randomUUID());
      else argv.push("--resume", providerSessionId);
      if (model !== null) argv.push("--model", model);
      if (start.effort !== undefined) argv.push("--effort", start.effort);
      if (start.permissionMode !== "ask") {
        argv.push("--permission-mode", "bypassPermissions");
      }
      return argv;
    }
    default:
      return new ProtocolHarnessUnsupportedError(harness);
  }
};

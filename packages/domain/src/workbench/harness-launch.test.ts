import { describe, expect, it } from "vitest";

import {
  ProtocolHarnessUnsupportedError,
  composeLaunchArgv,
  composeProtocolArgv,
} from "./harness-launch.ts";

describe("composeLaunchArgv", () => {
  it("composes the bare harness when every field is absent", () => {
    expect(composeLaunchArgv("claude", {})).toEqual(["claude"]);
    expect(composeLaunchArgv("codex", {})).toEqual(["codex"]);
    expect(composeLaunchArgv("opencode", {})).toEqual(["opencode"]);
    expect(composeLaunchArgv("shell", {})).toEqual(["bash"]);
  });

  it("puts the prompt last, after every flag", () => {
    expect(
      composeLaunchArgv("claude", {
        prompt: "fix the auth test",
        model: "sonnet",
        effort: "high",
        permissionMode: "ask",
      }),
    ).toEqual([
      "claude",
      "--model",
      "sonnet",
      "--effort",
      "high",
      "--permission-mode",
      "auto",
      "fix the auth test",
    ]);
  });

  it("maps codex effort through -c verbatim (xhigh included — codex accepts it)", () => {
    expect(composeLaunchArgv("codex", { effort: "xhigh", prompt: "p" })).toEqual([
      "codex",
      "-c",
      "model_reasoning_effort=xhigh",
      "p",
    ]);
    expect(composeLaunchArgv("codex", { effort: "low" })).toEqual([
      "codex",
      "-c",
      "model_reasoning_effort=low",
    ]);
  });

  it("emits no permission flag for bypass so the engine injects its default", () => {
    // withPermissionDefaults (engine) keys on --permission-mode / --sandbox.
    expect(composeLaunchArgv("claude", { permissionMode: "bypass" })).toEqual(["claude"]);
    expect(composeLaunchArgv("codex", { permissionMode: "bypass" })).toEqual(["codex"]);
  });

  it("names the permission flag for ask, suppressing the engine bypass injection", () => {
    expect(composeLaunchArgv("claude", { permissionMode: "ask" })).toContain("--permission-mode");
    expect(composeLaunchArgv("codex", { permissionMode: "ask" })).toEqual([
      "codex",
      "--sandbox",
      "danger-full-access",
      "--ask-for-approval",
      "on-request",
    ]);
  });

  it("routes an opencode prompt through run and ignores knobs it lacks", () => {
    expect(composeLaunchArgv("opencode", { prompt: "add tests", model: "x" })).toEqual([
      "opencode",
      "run",
      "add tests",
    ]);
  });

  it("maps fast speed to codex's priority service tier and ignores it on claude", () => {
    expect(composeLaunchArgv("codex", { speed: "fast", prompt: "p" })).toEqual([
      "codex",
      "-c",
      "service_tier=priority",
      "p",
    ]);
    expect(composeLaunchArgv("codex", { speed: "standard" })).toEqual(["codex"]);
    // claude has no launch-time fast flag; the field is ignored, not an error.
    expect(composeLaunchArgv("claude", { speed: "fast" })).toEqual(["claude"]);
  });

  it("passes max effort through on both harnesses", () => {
    expect(composeLaunchArgv("claude", { effort: "max" })).toEqual(["claude", "--effort", "max"]);
    expect(composeLaunchArgv("codex", { effort: "max" })).toEqual([
      "codex",
      "-c",
      "model_reasoning_effort=max",
    ]);
  });

  it("ignores prompt and knobs for shell", () => {
    expect(composeLaunchArgv("shell", { prompt: "ignored", effort: "high" })).toEqual(["bash"]);
  });

  it("treats whitespace-only prompt and model as absent", () => {
    expect(composeLaunchArgv("claude", { prompt: "  ", model: " " })).toEqual(["claude"]);
  });
});

describe("composeProtocolArgv", () => {
  it("keeps Codex model and effort off the app-server process argv", () => {
    expect(
      composeProtocolArgv("codex", {
        mode: "protocol",
        model: "gpt-test",
        effort: "high",
        permissionMode: "ask",
      }),
    ).toEqual(["codex", "app-server"]);
  });

  it("composes Claude stream-json resume flags and ask permissions", () => {
    expect(
      composeProtocolArgv(
        "claude",
        { mode: "protocol", model: "sonnet", effort: "high", permissionMode: "ask" },
        "11111111-1111-4111-8111-111111111111",
      ),
    ).toEqual([
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
      "--resume",
      "11111111-1111-4111-8111-111111111111",
      "--model",
      "sonnet",
      "--effort",
      "high",
    ]);
  });

  it("rejects harnesses without a protocol shape", () => {
    expect(composeProtocolArgv("opencode", {})).toBeInstanceOf(ProtocolHarnessUnsupportedError);
  });
});

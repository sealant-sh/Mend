import { describe, expect, it } from "vitest";

import { SealantWorkspaceId, SessionId, SessionProcessId } from "../src/ids.ts";
import { foldSessionLiveness } from "../src/workbench/session-fold.ts";
import { SessionProcess } from "../src/workbench/session-process.ts";

const process = (kind: "agent-protocol" | "agent-pty" | "shell") =>
  new SessionProcess({
    id: SessionProcessId.make(`${kind}-1`),
    sessionId: SessionId.make("session-1"),
    sealantWorkspaceId: SealantWorkspaceId.make("workspace-1"),
    sealantSessionId: "process-1",
    sealantRunId: null,
    launchCorrelationId: null,
    serviceId: null,
    attemptOrdinal: null,
    kind,
    harness: kind === "shell" ? null : "codex",
    providerSessionId: null,
    protocolOptions: null,
    label: kind,
    argv: ["command"],
    status: "running",
    exitCode: null,
    workspacePort: null,
    protocol: "tcp",
    hostPort: null,
    createdAt: new Date(0),
    exitedAt: null,
    updatedAt: new Date(0),
  });

describe("foldSessionLiveness", () => {
  it("reports waiting only for a live protocol process with a pending request", () => {
    expect(foldSessionLiveness([process("agent-protocol")], true)).toBe("waiting");
    expect(foldSessionLiveness([process("agent-protocol")], false)).toBe("running");
    expect(foldSessionLiveness([process("agent-pty")], true)).toBe("running");
  });

  it("keeps supporting-only and empty folds unchanged", () => {
    expect(foldSessionLiveness([process("shell")], true)).toBe("idle");
    expect(foldSessionLiveness([], true)).toBe("settled");
  });
});

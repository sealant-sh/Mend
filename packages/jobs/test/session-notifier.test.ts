import { SealantWorkspaceId, SessionId, SessionProcessId } from "@mend/domain";
import { SessionProcess } from "@mend/domain/workbench";
import { describe, expect, it } from "vitest";

import { phaseOf } from "../src/session-notifier.ts";

const agent = (patch: Partial<SessionProcess>) =>
  new SessionProcess({
    id: SessionProcessId.make("agent-1"),
    sessionId: SessionId.make("session-1"),
    sealantWorkspaceId: SealantWorkspaceId.make("ws-1"),
    sealantSessionId: "pty-1",
    sealantRunId: null,
    launchCorrelationId: null,
    serviceId: null,
    attemptOrdinal: null,
    kind: "agent-pty",
    harness: "claude",
    providerSessionId: null,
    label: "claude",
    argv: ["claude"],
    status: "running",
    exitCode: null,
    workspacePort: null,
    protocol: "tcp",
    hostPort: null,
    createdAt: new Date("2026-08-21T10:00:00.000Z"),
    exitedAt: null,
    updatedAt: new Date("2026-08-21T10:00:00.000Z"),
    ...patch,
  });

describe("phaseOf", () => {
  it("rings for the agent's own end behind an idle session, never for idle itself", () => {
    expect(phaseOf("idle", null)).toBeNull();
    expect(phaseOf("idle", agent({}))).toBeNull();
    const ended = new Date("2026-08-21T11:00:00.000Z");
    expect(phaseOf("idle", agent({ status: "exited", exitCode: 0, exitedAt: ended }))).toBe(
      "completed",
    );
    expect(phaseOf("idle", agent({ status: "exited", exitCode: 1, exitedAt: ended }))).toBe(
      "failed",
    );
    // The user's own stop is not news.
    expect(phaseOf("idle", agent({ status: "stopped", exitedAt: ended }))).toBeNull();
  });

  it("keeps the settled and waiting phases", () => {
    expect(phaseOf("waiting", null)).toBe("attention");
    expect(phaseOf("completed", null)).toBe("completed");
    expect(phaseOf("failed", null)).toBe("failed");
    expect(phaseOf("running", null)).toBeNull();
    expect(phaseOf("stopped", null)).toBeNull();
  });
});

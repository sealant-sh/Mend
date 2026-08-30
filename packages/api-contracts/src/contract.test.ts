import { SealantRunId, SessionProcessId } from "@mend/domain";
import { Schema } from "effect";
import { HttpApi } from "effect/unstable/httpapi";
import { describe, expect, it } from "vitest";

import { MendApi, ProcessLogPage, ProjectBranch } from "./index.ts";

const conversationEndpointNames = new Set(["submitTurn", "interruptTurn", "respondAgentRequest"]);

const typedEndpointNames = new Set([
  "followUpDeliver",
  "openReview",
  "processLogs",
  "reviewDiff",
  "renameShell",
  "sliceComment",
]);

describe("typed HTTP error contracts", () => {
  it("preserves not-found and validation status codes as separate schemas", () => {
    const statuses = new Map<string, ReadonlySet<number>>();

    HttpApi.reflect(MendApi, {
      onGroup: () => {},
      onEndpoint: ({ endpoint, errors }) => {
        if (typedEndpointNames.has(endpoint.name)) {
          statuses.set(endpoint.name, new Set(errors.keys()));
        }
      },
    });

    for (const name of typedEndpointNames) {
      const endpointStatuses = statuses.get(name);
      expect(endpointStatuses?.has(404), `${name} should preserve NotFound`).toBe(true);
      expect(endpointStatuses?.has(422), `${name} should preserve StoreFailure`).toBe(true);
      expect(endpointStatuses?.has(500), `${name} should not collapse its typed errors`).toBe(
        false,
      );
    }
  });

  it("preserves conversation not-found and conflict statuses", () => {
    const statuses = new Map<string, ReadonlySet<number>>();
    HttpApi.reflect(MendApi, {
      onGroup: () => {},
      onEndpoint: ({ endpoint, errors }) => {
        if (conversationEndpointNames.has(endpoint.name)) {
          statuses.set(endpoint.name, new Set(errors.keys()));
        }
      },
    });
    for (const name of conversationEndpointNames) {
      expect(statuses.get(name)?.has(404), `${name} should preserve NotFound`).toBe(true);
      expect(statuses.get(name)?.has(409), `${name} should preserve conflict`).toBe(true);
      expect(statuses.get(name)?.has(500), `${name} should not collapse errors`).toBe(false);
    }
  });

  it("encodes a process-log response as the endpoint's class schema", () => {
    const page = new ProcessLogPage({
      processId: SessionProcessId.make("process-1"),
      sealantSessionId: "pty-1",
      sealantRunId: SealantRunId.make("run-1"),
      requestedFrom: "0",
      firstSequence: "1",
      lastSequence: "1",
      nextFrom: "2",
      status: "running",
      chunks: [{ sequence: "1", dataBase64: "aGVsbG8=" }],
      telemetryLoss: "unknown",
      telemetryNote: "Sealant does not report retained-range loss for interactive-session output.",
    });

    expect(Schema.encodeUnknownSync(ProcessLogPage)(page)).toMatchObject({
      processId: "process-1",
      nextFrom: "2",
      telemetryLoss: "unknown",
    });
  });

  it("ProjectBranch encodes instances but refuses shape-alike plain objects", () => {
    // Class schemas encode INSTANCES only. A handler returning `{ name, sha, … }` compiles
    // (structural typing) and then 400s every response at runtime — observed live on
    // /projects/:id/refresh (v0.12.0); handlers must construct `new ProjectBranch(...)`.
    const codec = Schema.toCodecJson(Schema.Array(ProjectBranch));
    const fields = {
      name: "main",
      sha: "5654c8215770c29d395300a0d358739c767973b5",
      committedAt: "2026-08-30T02:21:51+03:00",
      isDefault: true,
    };
    expect(Schema.encodeUnknownSync(codec)([new ProjectBranch(fields)])).toMatchObject([
      { name: "main", isDefault: true },
    ]);
    expect(() => Schema.encodeUnknownSync(codec)([fields])).toThrow();
  });
});

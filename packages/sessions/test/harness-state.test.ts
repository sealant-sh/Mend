import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "@effect/vitest";
import {
  HarnessStateInvalidError,
  HarnessStateNotFoundError,
  readHarnessStateManifest,
} from "@mend/sessions";
import { Effect } from "effect";

const withStateDir = async <A>(run: (stateDir: string) => Promise<A>): Promise<A> => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "mend-harness-state-test-"));
  try {
    return await run(stateDir);
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
};

describe("readHarnessStateManifest", () => {
  it("reads a valid saved-state manifest", async () => {
    await withStateDir(async (stateDir) => {
      await fs.writeFile(
        path.join(stateDir, "manifest.json"),
        JSON.stringify({
          harness: "codex",
          providerSessionId: "01989f08-224f-7a83-a617-d511dc2c2cbd",
          capturedAt: "2026-08-10T12:00:00.000Z",
        }),
      );

      const manifest = await Effect.runPromise(readHarnessStateManifest(stateDir, "session-1"));

      expect(manifest.harness).toBe("codex");
      expect(manifest.providerSessionId).toBe("01989f08-224f-7a83-a617-d511dc2c2cbd");
    });
  });

  it("tags a missing manifest instead of treating it as a fresh session", async () => {
    await withStateDir(async (stateDir) => {
      const error = await Effect.runPromise(
        readHarnessStateManifest(stateDir, "session-2").pipe(Effect.flip),
      );

      expect(error).toBeInstanceOf(HarnessStateNotFoundError);
      expect(error.message).toContain("session-2");
    });
  });

  it("tags malformed JSON as invalid saved state", async () => {
    await withStateDir(async (stateDir) => {
      await fs.writeFile(path.join(stateDir, "manifest.json"), "{not json");

      const error = await Effect.runPromise(
        readHarnessStateManifest(stateDir, "session-3").pipe(Effect.flip),
      );

      expect(error).toBeInstanceOf(HarnessStateInvalidError);
      expect(error.message).toContain("session-3");
    });
  });

  it("tags a structurally incomplete manifest as invalid saved state", async () => {
    await withStateDir(async (stateDir) => {
      await fs.writeFile(
        path.join(stateDir, "manifest.json"),
        JSON.stringify({ harness: "codex" }),
      );

      const error = await Effect.runPromise(
        readHarnessStateManifest(stateDir, "session-4").pipe(Effect.flip),
      );

      expect(error).toBeInstanceOf(HarnessStateInvalidError);
    });
  });
});

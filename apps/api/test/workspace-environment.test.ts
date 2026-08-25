import { defaultSettings, MendSettings } from "@mend/domain";
import type { WorkspaceImage } from "@mend/domain";
import type { WorkspacePackageResolution } from "@mend/sealant";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  resolveWorkspaceEnvironment,
  saveResolvedWorkspaceEnvironmentWith,
} from "../src/services/workspace-environment.ts";

const workspaceImage = (packages: ReadonlyArray<string>): WorkspaceImage => ({
  mode: "family",
  os: "arch",
  packages,
  shell: "bash",
  services: { docker: true },
});

const resolution = (
  requested: string,
  overrides: Partial<WorkspacePackageResolution> = {},
): WorkspacePackageResolution => ({
  requested,
  normalized: requested,
  status: "resolved",
  canonicalId: requested,
  supported: true,
  packageName: requested,
  alternatives: [],
  ...overrides,
});

describe("resolveWorkspaceEnvironment", () => {
  it("resolves every package for the selected OS and saves canonical IDs once", async () => {
    const observed: Array<{ readonly packageName: string; readonly os: string }> = [];
    const result = await Effect.runPromise(
      resolveWorkspaceEnvironment(workspaceImage(["gh", "github-cli"]), (packageName, os) => {
        observed.push({ packageName, os });
        return Effect.succeed(
          resolution(packageName, { canonicalId: "github-cli", packageName: "github-cli" }),
        );
      }),
    );

    expect(observed).toEqual([
      { packageName: "gh", os: "arch" },
      { packageName: "github-cli", os: "arch" },
    ]);
    expect(result.workspaceImage).toEqual({
      mode: "family",
      os: "arch",
      packages: ["github-cli"],
      shell: "bash",
      services: { docker: true },
    });
  });

  it.each([
    resolution("missing", { status: "not-found", canonicalId: null, supported: false }),
    resolution("linux-only", { supported: false }),
  ])("refuses the entire environment when $requested is unresolved", async (rejected) => {
    const result = await Effect.runPromise(
      resolveWorkspaceEnvironment(workspaceImage(["pnpm", rejected.requested]), (packageName) =>
        Effect.succeed(packageName === rejected.requested ? rejected : resolution(packageName)),
      ),
    );

    expect(result.workspaceImage).toBeNull();
    expect(result.resolutions).toHaveLength(2);
  });

  it("merges a resolved environment into settings read after validation", async () => {
    let current = new MendSettings({ ...defaultSettings, autoTour: false });
    const requested = workspaceImage(["pnpm"]);

    const result = await Effect.runPromise(
      saveResolvedWorkspaceEnvironmentWith(
        requested,
        (latest, resolved) => new MendSettings({ ...latest, workspaceImage: resolved }),
        {
          getSettings: () => Effect.succeed(current),
          modifySettings: (update) =>
            Effect.sync(() => {
              current = new MendSettings({ ...current, autoTour: true });
              current = update(current);
              return current;
            }),
          resolvePackage: (packageName) => Effect.succeed(resolution(packageName)),
        },
      ),
    );

    expect(result.saved).toBe(true);
    expect(result.settings.autoTour).toBe(true);
    expect(result.settings.workspaceImage).toEqual(requested);
  });
});

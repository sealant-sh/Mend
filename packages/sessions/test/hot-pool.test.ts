import { defaultWorkspaceImage } from "@mend/domain";
import { describe, expect, it } from "vitest";

import { hotFingerprint, type HotFingerprintInputs } from "../src/hot-pool.ts";

const base: HotFingerprintInputs = {
  workspaceImage: defaultWorkspaceImage,
  applyDotfiles: true,
  dotfiles: {
    repository: { url: "git@github.com:acme/dots.git", ref: null },
    snapshotSha: "abc123",
  },
  environmentRevision: 3,
  secretRevision: 1,
  references: [
    { name: "effect", path: "/store/_references/effect" },
    { name: "drizzle", path: "/store/_references/drizzle" },
  ],
  mounts: [{ name: "notes", hostPath: "/home/u/notes", readOnly: true }],
};

describe("hotFingerprint", () => {
  it("is stable across reference and mount ordering", () => {
    const reordered: HotFingerprintInputs = {
      ...base,
      references: base.references.toReversed(),
      mounts: base.mounts.toReversed(),
    };
    expect(hotFingerprint(reordered)).toBe(hotFingerprint(base));
  });

  it("changes when any create-time input changes", () => {
    const variants: ReadonlyArray<HotFingerprintInputs> = [
      { ...base, environmentRevision: base.environmentRevision + 1 },
      { ...base, secretRevision: base.secretRevision + 1 },
      { ...base, applyDotfiles: false },
      { ...base, dotfiles: { ...base.dotfiles, snapshotSha: "def456" } },
      { ...base, dotfiles: { repository: null, snapshotSha: base.dotfiles.snapshotSha } },
      {
        ...base,
        workspaceImage: {
          mode: "family",
          os: "nix",
          packages: [],
          shell: "bash",
          services: { docker: true },
        },
      },
      { ...base, references: base.references.slice(1) },
      {
        ...base,
        mounts: [{ name: "notes", hostPath: "/home/u/notes", readOnly: false }],
      },
    ];
    const seen = new Set([hotFingerprint(base)]);
    for (const variant of variants) {
      const fingerprint = hotFingerprint(variant);
      expect(seen.has(fingerprint)).toBe(false);
      seen.add(fingerprint);
    }
  });
});

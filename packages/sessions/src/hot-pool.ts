import { createHash } from "node:crypto";

import { WorkspaceImage } from "@mend/domain";
import { Schema } from "effect";

/**
 * Everything `workspaces.create` fixes for the lifetime of a workspace, resolved to comparable
 * facts. A hot workspace is claimable only while the project still resolves to the same inputs —
 * the platform offers no way to mutate a live workspace, so a mismatch means drain-and-rewarm.
 *
 * Deliberately absent: the base ref (the worktree is a bind mount, freshened host-side at claim)
 * and reference head SHAs (reference mounts are live host clones; the mounted content is whatever
 * is on disk either way).
 */
export interface HotFingerprintInputs {
  readonly workspaceImage: WorkspaceImage;
  readonly applyDotfiles: boolean;
  readonly dotfiles: {
    readonly repository: { readonly url: string; readonly ref: string | null } | null;
    readonly snapshotSha: string | null;
  };
  readonly environmentRevision: number;
  readonly secretRevision: number;
  readonly references: ReadonlyArray<{ readonly name: string; readonly path: string }>;
  readonly mounts: ReadonlyArray<{
    readonly name: string;
    readonly hostPath: string;
    readonly readOnly: boolean;
  }>;
}

const encodeWorkspaceImage = Schema.encodeSync(WorkspaceImage);

const byName = <T extends { readonly name: string }>(items: ReadonlyArray<T>): ReadonlyArray<T> =>
  items.toSorted((a, b) => a.name.localeCompare(b.name));

/** Stable content hash of the create-time-fixed inputs; key order is fixed by construction. */
export const hotFingerprint = (inputs: HotFingerprintInputs): string => {
  const canonical = {
    workspaceImage: encodeWorkspaceImage(inputs.workspaceImage),
    applyDotfiles: inputs.applyDotfiles,
    dotfiles: {
      repository:
        inputs.dotfiles.repository === null
          ? null
          : { url: inputs.dotfiles.repository.url, ref: inputs.dotfiles.repository.ref },
      snapshotSha: inputs.dotfiles.snapshotSha,
    },
    environmentRevision: inputs.environmentRevision,
    secretRevision: inputs.secretRevision,
    references: byName(inputs.references).map((r) => ({ name: r.name, path: r.path })),
    mounts: byName(inputs.mounts).map((m) => ({
      name: m.name,
      hostPath: m.hostPath,
      readOnly: m.readOnly,
    })),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
};

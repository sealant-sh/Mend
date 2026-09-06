import { createHash } from "node:crypto";

import { WorkspaceImage } from "@mend/domain";
import { Schema } from "effect";

/**
 * Everything fixed when a hot workspace is prepared, resolved to comparable facts. A hot
 * workspace is claimable only while the project still resolves to the same inputs. The platform
 * cannot mutate create-time inputs, and skills are already materialized in its harness home, so a
 * mismatch means drain-and-rewarm.
 *
 * Deliberately absent: the base ref (the worktree is a bind mount, freshened host-side at claim)
 * and reference head SHAs (reference mounts are live host clones; the mounted content is whatever
 * is on disk either way).
 */
export interface HotFingerprintInputs {
  readonly workspaceImage: WorkspaceImage;
  readonly applyDotfiles: boolean;
  /** Skills are written before boot; a toggle must invalidate already-prepared harness homes. */
  readonly inheritUserSkills: boolean;
  /** The resolved delivered bundles. Revisions change whenever bundle contents change. */
  readonly skills: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly revision: number;
  }>;
  readonly dotfiles: {
    readonly repository: {
      readonly url: string;
      readonly ref: string | null;
    } | null;
    readonly snapshotSha: string | null;
  };
  readonly environmentRevision: number;
  readonly secretRevision: number;
  /** Cluster bindings are create-time-fixed too: a binding/SA mutation drains warm skeletons. */
  readonly clusterBindingRevision: number;
  readonly references: ReadonlyArray<{
    readonly name: string;
    readonly path: string;
  }>;
  readonly mounts: ReadonlyArray<{
    readonly name: string;
    readonly hostPath: string;
    readonly readOnly: boolean;
  }>;
  /**
   * Linked projects (ADR-0001): the root mounted per link is create-time-fixed; WHICH worktree
   * is bound is not (the launch binds it), so the worktree name stays out.
   */
  readonly links: ReadonlyArray<{
    readonly name: string;
    readonly rootPath: string;
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
    inheritUserSkills: inputs.inheritUserSkills,
    skills: byName(inputs.skills).map((skill) => ({
      id: skill.id,
      name: skill.name,
      revision: skill.revision,
    })),
    dotfiles: {
      repository:
        inputs.dotfiles.repository === null
          ? null
          : {
              url: inputs.dotfiles.repository.url,
              ref: inputs.dotfiles.repository.ref,
            },
      snapshotSha: inputs.dotfiles.snapshotSha,
    },
    environmentRevision: inputs.environmentRevision,
    secretRevision: inputs.secretRevision,
    clusterBindingRevision: inputs.clusterBindingRevision,
    references: byName(inputs.references).map((r) => ({
      name: r.name,
      path: r.path,
    })),
    mounts: byName(inputs.mounts).map((m) => ({
      name: m.name,
      hostPath: m.hostPath,
      readOnly: m.readOnly,
    })),
    links: byName(inputs.links).map((l) => ({
      name: l.name,
      rootPath: l.rootPath,
    })),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
};

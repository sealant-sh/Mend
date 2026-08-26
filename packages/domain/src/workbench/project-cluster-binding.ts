import { Schema } from "effect";

import { ProjectClusterBindingId, ProjectId } from "../ids.ts";
import { Timestamp } from "../timestamp.ts";

/**
 * A project-level CLUSTER BINDING (`.plans/cluster-env-sources.md`): the name of a Kubernetes
 * Secret or ConfigMap in the platform's workspaces namespace whose keys become workspace
 * environment. Mend stores the binding — kind + object name — and NEVER the keys or values
 * inside the bound object; the Sealant worker resolves the object at each fresh workspace
 * launch. On a non-cluster install a declared binding blocks launches (the platform refuses at
 * create time with `runtime-env-references-unsupported`) rather than silently shipping an
 * incomplete environment.
 */

export const CLUSTER_BINDING_KINDS = ["secret", "configmap"] as const;
export type ClusterBindingKind = (typeof CLUSTER_BINDING_KINDS)[number];

/** Matches the platform's create boundary (`envFrom` max 16 entries). */
export const CLUSTER_BINDING_MAX_ENTRIES = 16;

export const CLUSTER_OBJECT_NAME_MAX_LENGTH = 253;
/** DNS-1123 subdomain — Kubernetes object names, NOT the env-name grammar. */
export const CLUSTER_OBJECT_NAME_PATTERN = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/;

export class ProjectClusterBinding extends Schema.Class<ProjectClusterBinding>(
  "ProjectClusterBinding",
)({
  id: ProjectClusterBindingId,
  projectId: ProjectId,
  kind: Schema.Literals(CLUSTER_BINDING_KINDS),
  objectName: Schema.String,
  /** Integer row revision; there is no value column for it to guard, but the discipline holds. */
  revision: Schema.Int,
  createdAt: Timestamp,
  updatedAt: Timestamp,
}) {}

/**
 * The project's cluster bindings as the API shows them: kind/name-ordered bindings, the aggregate
 * revision, and the workspace service account (an operator trust grant recorded by name; null =
 * none requested). No env names, no values — Mend cannot know them.
 */
export class ProjectClusterBindingsSnapshot extends Schema.Class<ProjectClusterBindingsSnapshot>(
  "ProjectClusterBindingsSnapshot",
)({
  revision: Schema.Int,
  bindings: Schema.Array(ProjectClusterBinding),
  serviceAccount: Schema.NullOr(Schema.String),
}) {}

export interface ClusterBindingIssue {
  readonly rule: "name-grammar" | "name-length";
}

/** Kubernetes object names: DNS-1123 subdomain grammar, length 1–253. */
export const validateClusterObjectName = (name: string): ClusterBindingIssue | null => {
  if (name.length === 0 || name.length > CLUSTER_OBJECT_NAME_MAX_LENGTH) {
    return { rule: "name-length" };
  }
  if (!CLUSTER_OBJECT_NAME_PATTERN.test(name)) return { rule: "name-grammar" };
  return null;
};

export const formatClusterBindingIssue = (issue: ClusterBindingIssue): string =>
  issue.rule === "name-length"
    ? `Object names are 1–${CLUSTER_OBJECT_NAME_MAX_LENGTH} characters.`
    : "Object names are DNS-1123 subdomains: lowercase letters, digits, '-' and '.', starting and ending alphanumeric.";

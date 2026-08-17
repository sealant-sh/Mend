import { redirect } from "@tanstack/react-router";
import { Schema } from "effect";

/**
 * Browser client for the project-environment group. Unlike the DTO-typed readers in `api.ts`,
 * every response here is RUNTIME-PARSED (`.plans/project-environment-variables.md`): values are
 * user configuration that round-trips into workspaces, so a shape drift must fail loudly at the
 * boundary, not surface later as a corrupted settings row.
 */

export const ProjectEnvironmentVariableView = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  name: Schema.String,
  value: Schema.String,
  revision: Schema.Int,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type ProjectEnvironmentVariableView = typeof ProjectEnvironmentVariableView.Type;

export const ProjectEnvironmentSnapshotView = Schema.Struct({
  revision: Schema.Int,
  variables: Schema.Array(ProjectEnvironmentVariableView),
});
export type ProjectEnvironmentSnapshotView = typeof ProjectEnvironmentSnapshotView.Type;

export const ProjectEnvironmentMutationView = Schema.Struct({
  variable: Schema.NullOr(ProjectEnvironmentVariableView),
  revision: Schema.Int,
});
export type ProjectEnvironmentMutationView = typeof ProjectEnvironmentMutationView.Type;

const EnvironmentIssueView = Schema.Struct({
  field: Schema.NullOr(Schema.Literals(["name", "value"])),
  rule: Schema.String,
  message: Schema.String,
});
export type EnvironmentIssueView = typeof EnvironmentIssueView.Type;

const RejectedBody = Schema.Struct({
  _tag: Schema.Literal("EnvironmentRejected"),
  issues: Schema.Array(EnvironmentIssueView),
});

const StaleBody = Schema.Struct({
  _tag: Schema.Literal("EnvironmentStaleWrite"),
  variableId: Schema.String,
  currentRevision: Schema.Int,
});

/** Every way an environment write can come back; `ok: false` keeps the caller's draft intact. */
export type ProjectEnvironmentWriteResult =
  | { readonly ok: true; readonly result: ProjectEnvironmentMutationView }
  | {
      readonly ok: false;
      readonly kind: "rejected";
      readonly issues: ReadonlyArray<EnvironmentIssueView>;
    }
  | { readonly ok: false; readonly kind: "stale"; readonly currentRevision: number }
  | { readonly ok: false; readonly kind: "http"; readonly status: number };

const decodeSnapshot = Schema.decodeUnknownSync(ProjectEnvironmentSnapshotView);
const decodeMutation = Schema.decodeUnknownSync(ProjectEnvironmentMutationView);
const decodeRejected = Schema.decodeUnknownSync(RejectedBody);
const decodeStale = Schema.decodeUnknownSync(StaleBody);

export const fetchProjectEnvironment = async (
  projectId: string,
): Promise<ProjectEnvironmentSnapshotView> => {
  const response = await fetch(`/api/projects/${projectId}/environment`, {
    credentials: "include",
  });
  if (response.status === 401) throw redirect({ to: "/login" });
  if (!response.ok) {
    throw new Error(`GET /api/projects/${projectId}/environment responded ${response.status}`);
  }
  return decodeSnapshot(await response.json());
};

const writeResult = async (response: Response): Promise<ProjectEnvironmentWriteResult> => {
  if (response.status === 401) throw redirect({ to: "/login" });
  if (response.ok) {
    return { ok: true, result: decodeMutation(await response.json()) };
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 422) {
    try {
      return { ok: false, kind: "rejected", issues: decodeRejected(body).issues };
    } catch {
      return { ok: false, kind: "http", status: response.status };
    }
  }
  if (response.status === 409) {
    try {
      return { ok: false, kind: "stale", currentRevision: decodeStale(body).currentRevision };
    } catch {
      return { ok: false, kind: "http", status: response.status };
    }
  }
  return { ok: false, kind: "http", status: response.status };
};

export const createProjectEnvironmentVariable = async (
  projectId: string,
  input: { readonly name: string; readonly value: string },
): Promise<ProjectEnvironmentWriteResult> =>
  writeResult(
    await fetch(`/api/projects/${projectId}/environment/variables`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );

/** Value edit and rename are the same atomic call on the same stable ID. */
export const updateProjectEnvironmentVariable = async (
  projectId: string,
  variableId: string,
  input: { readonly name: string; readonly value: string; readonly expectedRevision: number },
): Promise<ProjectEnvironmentWriteResult> =>
  writeResult(
    await fetch(`/api/projects/${projectId}/environment/variables/${variableId}`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );

export const removeProjectEnvironmentVariable = async (
  projectId: string,
  variableId: string,
  expectedRevision: number,
): Promise<ProjectEnvironmentWriteResult> =>
  writeResult(
    await fetch(`/api/projects/${projectId}/environment/variables/${variableId}`, {
      method: "DELETE",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision }),
    }),
  );

// ── Secrets: the encrypted, write-only half of the store ───────────────────────────────────────

export const ProjectSecretView = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  name: Schema.String,
  revision: Schema.Int,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type ProjectSecretView = typeof ProjectSecretView.Type;

export const ProjectSecretsSnapshotView = Schema.Struct({
  revision: Schema.Int,
  secrets: Schema.Array(ProjectSecretView),
});
export type ProjectSecretsSnapshotView = typeof ProjectSecretsSnapshotView.Type;

const ProjectSecretMutationView = Schema.Struct({
  secret: Schema.NullOr(ProjectSecretView),
  revision: Schema.Int,
});
export type ProjectSecretMutationView = typeof ProjectSecretMutationView.Type;

export type ProjectSecretWriteResult =
  | { readonly ok: true; readonly result: ProjectSecretMutationView }
  | {
      readonly ok: false;
      readonly kind: "rejected";
      readonly issues: ReadonlyArray<EnvironmentIssueView>;
    }
  | { readonly ok: false; readonly kind: "stale"; readonly currentRevision: number }
  | { readonly ok: false; readonly kind: "http"; readonly status: number };

const decodeSecrets = Schema.decodeUnknownSync(ProjectSecretsSnapshotView);
const decodeSecretMutation = Schema.decodeUnknownSync(ProjectSecretMutationView);

export const fetchProjectSecrets = async (
  projectId: string,
): Promise<ProjectSecretsSnapshotView> => {
  const response = await fetch(`/api/projects/${projectId}/secrets`, { credentials: "include" });
  if (response.status === 401) throw redirect({ to: "/login" });
  if (!response.ok) {
    throw new Error(`GET /api/projects/${projectId}/secrets responded ${response.status}`);
  }
  return decodeSecrets(await response.json());
};

const secretWriteResult = async (response: Response): Promise<ProjectSecretWriteResult> => {
  if (response.status === 401) throw redirect({ to: "/login" });
  if (response.ok) {
    return { ok: true, result: decodeSecretMutation(await response.json()) };
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 422) {
    try {
      return { ok: false, kind: "rejected", issues: decodeRejected(body).issues };
    } catch {
      return { ok: false, kind: "http", status: response.status };
    }
  }
  if (response.status === 409) {
    try {
      return { ok: false, kind: "stale", currentRevision: decodeStale(body).currentRevision };
    } catch {
      return { ok: false, kind: "http", status: response.status };
    }
  }
  return { ok: false, kind: "http", status: response.status };
};

export const createProjectSecret = async (
  projectId: string,
  input: { readonly name: string; readonly value: string },
): Promise<ProjectSecretWriteResult> =>
  secretWriteResult(
    await fetch(`/api/projects/${projectId}/secrets`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );

/** `value: null` keeps the stored value (pure rename); a string replaces it. */
export const updateProjectSecret = async (
  projectId: string,
  secretId: string,
  input: {
    readonly name: string;
    readonly value: string | null;
    readonly expectedRevision: number;
  },
): Promise<ProjectSecretWriteResult> =>
  secretWriteResult(
    await fetch(`/api/projects/${projectId}/secrets/${secretId}`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );

export const removeProjectSecret = async (
  projectId: string,
  secretId: string,
  expectedRevision: number,
): Promise<ProjectSecretWriteResult> =>
  secretWriteResult(
    await fetch(`/api/projects/${projectId}/secrets/${secretId}`, {
      method: "DELETE",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision }),
    }),
  );

// ── Load a whole .env ────────────────────────────────────────────────────────────────────────────

export const EnvironmentLoadReportView = Schema.Struct({
  loaded: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      lane: Schema.Literals(["configuration", "secret"]),
      action: Schema.Literals(["created", "updated", "moved"]),
    }),
  ),
  rejected: Schema.Array(Schema.Struct({ name: Schema.String, reason: Schema.String })),
  malformedLines: Schema.Array(Schema.Int),
  environmentRevision: Schema.Int,
  secretRevision: Schema.Int,
});
export type EnvironmentLoadReportView = typeof EnvironmentLoadReportView.Type;

const decodeLoadReport = Schema.decodeUnknownSync(EnvironmentLoadReportView);

/**
 * Post raw dotenv text; the server parses, routes each name (Configuration or Secrets), upserts,
 * and reports per name. The text crosses this request only — nothing in the response is a value.
 */
export const loadProjectEnvironment = async (
  projectId: string,
  input: {
    readonly contents: string;
    readonly allSecret: boolean;
    readonly secretNames: ReadonlyArray<string>;
  },
): Promise<EnvironmentLoadReportView> => {
  const response = await fetch(`/api/projects/${projectId}/environment/load`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (response.status === 401) throw redirect({ to: "/login" });
  if (!response.ok) {
    throw new Error(
      `POST /api/projects/${projectId}/environment/load responded ${response.status}`,
    );
  }
  return decodeLoadReport(await response.json());
};

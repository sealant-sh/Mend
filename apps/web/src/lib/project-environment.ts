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

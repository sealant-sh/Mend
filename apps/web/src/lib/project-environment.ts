import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "../server/router.ts";
import { orLogin, trpc } from "./trpc.ts";

/**
 * Browser facade for the project-environment group. The shapes come from the
 * wire contract via the tRPC router, which decodes every response against
 * @mend/api-contracts server-side (`.plans/project-environment-variables.md`:
 * values are user configuration that round-trips into workspaces, so drift
 * must fail loudly at the boundary). 422/409 arrive as structured OUTCOMES —
 * the discriminated unions below — because the UI keeps drafts on a stale
 * write and shows per-field issues on a rejection.
 */

type Outputs = inferRouterOutputs<AppRouter>;

export type ProjectEnvironmentSnapshotView = Outputs["environment"]["environment"];
export type ProjectEnvironmentVariableView = ProjectEnvironmentSnapshotView["variables"][number];

type EnvironmentWriteOutcome = Outputs["environment"]["createVariable"];
export type ProjectEnvironmentWriteResult = EnvironmentWriteOutcome;
export type ProjectEnvironmentMutationView = Extract<
  EnvironmentWriteOutcome,
  { ok: true }
>["result"];
export type EnvironmentIssueView = Extract<
  EnvironmentWriteOutcome,
  { kind: "rejected" }
>["issues"][number];

export type ProjectSecretsSnapshotView = Outputs["environment"]["secrets"];
export type ProjectSecretView = ProjectSecretsSnapshotView["secrets"][number];

type SecretWriteOutcome = Outputs["environment"]["createSecret"];
export type ProjectSecretWriteResult = SecretWriteOutcome;
export type ProjectSecretMutationView = Extract<SecretWriteOutcome, { ok: true }>["result"];

export type EnvironmentLoadReportView = Outputs["environment"]["load"];

export const fetchProjectEnvironment = (projectId: string) =>
  orLogin(trpc.environment.environment.query({ projectId }));

export const createProjectEnvironmentVariable = (
  projectId: string,
  input: { readonly name: string; readonly value: string },
) => orLogin(trpc.environment.createVariable.mutate({ projectId, ...input }));

/** Value edit and rename are the same atomic call on the same stable ID. */
export const updateProjectEnvironmentVariable = (
  projectId: string,
  variableId: string,
  input: { readonly name: string; readonly value: string; readonly expectedRevision: number },
) => orLogin(trpc.environment.updateVariable.mutate({ projectId, variableId, ...input }));

export const removeProjectEnvironmentVariable = (
  projectId: string,
  variableId: string,
  expectedRevision: number,
) => orLogin(trpc.environment.removeVariable.mutate({ projectId, variableId, expectedRevision }));

export const fetchProjectSecrets = (projectId: string) =>
  orLogin(trpc.environment.secrets.query({ projectId }));

export const createProjectSecret = (
  projectId: string,
  input: { readonly name: string; readonly value: string },
) => orLogin(trpc.environment.createSecret.mutate({ projectId, ...input }));

/** `value: null` keeps the stored value (pure rename); a string replaces it. */
export const updateProjectSecret = (
  projectId: string,
  secretId: string,
  input: {
    readonly name: string;
    readonly value: string | null;
    readonly expectedRevision: number;
  },
) => orLogin(trpc.environment.updateSecret.mutate({ projectId, secretId, ...input }));

export const removeProjectSecret = (
  projectId: string,
  secretId: string,
  expectedRevision: number,
) => orLogin(trpc.environment.removeSecret.mutate({ projectId, secretId, expectedRevision }));

/**
 * Post raw dotenv text; the server parses, routes each name (Configuration or Secrets), upserts,
 * and reports per name. The text crosses this request only — nothing in the response is a value.
 */
export const loadProjectEnvironment = (
  projectId: string,
  input: {
    readonly contents: string;
    readonly allSecret: boolean;
    readonly secretNames: ReadonlyArray<string>;
  },
) => orLogin(trpc.environment.load.mutate({ projectId, ...input }));

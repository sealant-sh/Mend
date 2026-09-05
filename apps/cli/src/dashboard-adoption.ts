import {
  RepositoryCloneUrl,
  repositoryCloneUrlIssue,
  type GitAuthMode,
} from "@mend/domain/workbench";

import type { ProjectDto } from "./dashboard-model.ts";
import { normalizeProjectName, type CwdFacts } from "./shared.ts";

/** A network origin offered for adoption, never the checkout's local path. */
export interface AdoptOffer {
  readonly source: RepositoryCloneUrl;
  readonly name: string;
  readonly modeIndex: number;
}

/** A missing or local origin does not offer adoption; cwd project matching is separate. */
export const deriveAdoptOffer = (facts: CwdFacts): AdoptOffer | null => {
  if (
    facts.repoRoot === null ||
    facts.originUrl === null ||
    repositoryCloneUrlIssue(facts.originUrl) !== null
  )
    return null;
  return {
    source: RepositoryCloneUrl.make(facts.originUrl),
    name: normalizeProjectName(facts.repoRoot.split("/").at(-1) ?? "project"),
    modeIndex: 0,
  };
};

/** The dashboard either reports invalid input locally or receives an adopted project. */
export type DashboardAdoptionResult =
  | { readonly kind: "invalid-source"; readonly message: string }
  | { readonly kind: "adopted"; readonly project: ProjectDto };

/** Recheck selected input at submission, before it can reach even an older server. */
export const submitDashboardAdoption = async (
  api: (
    method: "POST",
    route: "/projects",
    body: {
      readonly name: string;
      readonly source: RepositoryCloneUrl;
      readonly gitAuthMode: GitAuthMode;
    },
  ) => Promise<ProjectDto>,
  input: { readonly name: string; readonly source: string; readonly gitAuthMode: GitAuthMode },
): Promise<DashboardAdoptionResult> => {
  const issue = repositoryCloneUrlIssue(input.source);
  if (issue !== null) return { kind: "invalid-source", message: issue };
  const project = await api("POST", "/projects", {
    name: input.name,
    source: RepositoryCloneUrl.make(input.source),
    gitAuthMode: input.gitAuthMode,
  });
  return { kind: "adopted", project };
};

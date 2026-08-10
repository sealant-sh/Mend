import { CONTINUE_COMMANDS } from "./shared.ts";

export interface ReviewSessionLike {
  readonly id: string;
  readonly harness: string;
}

export interface ReviewAnnotationLike {
  readonly changeId: string | null;
}

export const reviewTargetForSession = <Session extends ReviewSessionLike>(
  session: Session,
  annotation: ReviewAnnotationLike | undefined,
  projectName: string,
): { readonly session: Session; readonly changeId: string; readonly projectName: string } | null =>
  annotation?.changeId === null || annotation?.changeId === undefined
    ? null
    : { session, changeId: annotation.changeId, projectName };

export const commentRange = (
  start: number | null,
  current: number,
): { readonly line: number; readonly endLine: number | null } =>
  start === null
    ? { line: current, endLine: null }
    : { line: Math.min(start, current), endLine: Math.max(start, current) };

export type ReviewApi = (method: "GET" | "POST", route: string, body?: unknown) => Promise<unknown>;

/** Close the review loop without changing session identity or worktree. */
export const deliverReview = async (
  api: ReviewApi,
  session: ReviewSessionLike,
  instruction: string,
): Promise<void> => {
  const build = CONTINUE_COMMANDS[session.harness];
  if (build === undefined)
    throw new Error(`Harness “${session.harness}” has no known relaunch command`);
  await api("POST", `/sessions/${session.id}/follow-up/deliver`, {});
  await api("POST", `/sessions/${session.id}/launch`, { argv: build(instruction) });
};

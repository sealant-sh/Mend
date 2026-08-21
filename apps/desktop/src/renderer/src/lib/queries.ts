import { QueryClient, queryOptions } from "@tanstack/react-query";

import {
  changeComments,
  isUnauthorized,
  listProjects,
  listSessionProcesses,
  processOutput,
  projectDetail,
  reviewDiff,
  sessionDetail,
} from "#/lib/api";

/**
 * One QueryClient for the cockpit. Workbench events invalidate by key
 * (#/lib/events); a 401 is never retried — the credential is the problem,
 * and the connect screen is the fix.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: (count, error) => !isUnauthorized(error) && count < 1,
    },
  },
});

export const projectsQuery = queryOptions({
  queryKey: ["projects"],
  queryFn: listProjects,
});

export const projectDetailQuery = (id: string) =>
  queryOptions({
    queryKey: ["project", id],
    queryFn: () => projectDetail(id),
  });

export const sessionDetailQuery = (id: string) =>
  queryOptions({
    queryKey: ["session", id],
    queryFn: () => sessionDetail(id),
  });

export const sessionProcessesQuery = (id: string) =>
  queryOptions({
    queryKey: ["session", id, "processes"],
    queryFn: () => listSessionProcesses(id),
  });

export const processOutputQuery = (id: string) =>
  queryOptions({
    queryKey: ["process", id, "output"],
    queryFn: () => processOutput(id),
    staleTime: Number.POSITIVE_INFINITY,
  });

export const reviewDiffQuery = (
  changeId: string,
  sliceId: string,
  options: { readonly whitespace: "include" | "ignore"; readonly context: number },
) =>
  queryOptions({
    queryKey: ["change", changeId, "review", sliceId, options],
    queryFn: () => reviewDiff(changeId, sliceId, options),
  });

export const reviewCommentsQuery = (changeId: string) =>
  queryOptions({
    queryKey: ["change", changeId, "comments"],
    queryFn: () => changeComments(changeId),
  });

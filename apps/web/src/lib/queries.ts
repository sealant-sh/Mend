import { QueryClient, queryOptions } from "@tanstack/react-query";

import {
  changeComments,
  changeDiff,
  listActiveSessions,
  listProjects,
  projectDetail,
  sessionDetail,
} from "#/lib/api";

/**
 * One QueryClient for the workbench pages (module singleton — every workbench
 * route is `ssr: false`, so loaders and queries run client-side only). SSE
 * events invalidate by key (#/lib/workbench-events); loaders `ensureQueryData`
 * so navigation lands on cached data and refreshes underneath.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: 1,
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

export const activeSessionsQuery = queryOptions({
  queryKey: ["sessions", "active"],
  queryFn: listActiveSessions,
});

export const sessionDetailQuery = (id: string) =>
  queryOptions({
    queryKey: ["session", id],
    queryFn: () => sessionDetail(id),
  });

export const changeDiffQuery = (id: string) =>
  queryOptions({
    queryKey: ["change", id, "diff"],
    queryFn: () => changeDiff(id),
  });

export const changeCommentsQuery = (id: string) =>
  queryOptions({
    queryKey: ["change", id, "comments"],
    queryFn: () => changeComments(id),
  });

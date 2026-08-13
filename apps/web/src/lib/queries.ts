import { QueryClient, queryOptions } from "@tanstack/react-query";

import {
  listSessionProcesses,
  listSessionRecipes,
  changeComments,
  changeDiff,
  changePasses,
  changeStats,
  changeTour,
  getSettings,
  gitKey,
  listActiveSessions,
  listProjects,
  listReferences,
  pendingFollowUp,
  projectDetail,
  projectMounts,
  projectRecipes,
  projectReferences,
  sessionDetail,
  sessionTranscript,
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

export const referencesQuery = queryOptions({
  queryKey: ["references"],
  queryFn: listReferences,
});

export const gitKeyQuery = queryOptions({
  queryKey: ["git-key"],
  queryFn: gitKey,
});

export const projectReferencesQuery = (id: string) =>
  queryOptions({
    queryKey: ["project", id, "references"],
    queryFn: () => projectReferences(id),
  });

export const projectMountsQuery = (id: string) =>
  queryOptions({
    queryKey: ["project", id, "mounts"],
    queryFn: () => projectMounts(id),
  });

export const projectRecipesQuery = (id: string) =>
  queryOptions({
    queryKey: ["project", id, "service-recipes"],
    queryFn: () => projectRecipes(id),
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

export const sessionProcessesQuery = (id: string) =>
  queryOptions({
    queryKey: ["session", id, "processes"],
    queryFn: () => listSessionProcesses(id),
  });

export const sessionRecipesQuery = (id: string) =>
  queryOptions({
    queryKey: ["session", id, "recipes"],
    queryFn: () => listSessionRecipes(id),
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

export const pendingFollowUpQuery = (sessionId: string) =>
  queryOptions({
    queryKey: ["session", sessionId, "follow-up"],
    queryFn: () => pendingFollowUp(sessionId),
  });

export const sessionTranscriptQuery = (sessionId: string) =>
  queryOptions({
    queryKey: ["session", sessionId, "transcript"],
    queryFn: () => sessionTranscript(sessionId),
  });

/** Lazy per-row diff stats; a git spawn per fetch, so cache generously. */
export const changeStatsQuery = (changeId: string) =>
  queryOptions({
    queryKey: ["change", changeId, "stats"],
    queryFn: () => changeStats(changeId),
    staleTime: 60_000,
  });

export const changeTourQuery = (changeId: string) =>
  queryOptions({
    queryKey: ["change", changeId, "tour"],
    queryFn: () => changeTour(changeId),
  });

export const changePassesQuery = (changeId: string) =>
  queryOptions({
    queryKey: ["change", changeId, "passes"],
    queryFn: () => changePasses(changeId),
  });

export const settingsQuery = queryOptions({
  queryKey: ["settings"],
  queryFn: getSettings,
});

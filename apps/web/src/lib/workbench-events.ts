import { useEffect } from "react";

import type { WorkbenchEventDto } from "#/lib/api";
import { queryClient } from "#/lib/queries";

/**
 * One SSE subscription per mounted page: workbench events invalidate exactly
 * the queries they point at (plan §9.4 — payloads are pointers, clients
 * re-read through the API). `session-progress` is deliberately NOT an
 * invalidation — it fires per record entry; pages that render live lines
 * take it through `onEvent` and keep component state.
 */
export const useWorkbenchEvents = (onEvent?: (event: WorkbenchEventDto) => void) => {
  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onmessage = (message: MessageEvent<string>) => {
      let event: WorkbenchEventDto;
      try {
        event = JSON.parse(message.data) as WorkbenchEventDto;
      } catch {
        return;
      }
      switch (event.type) {
        case "project":
          void queryClient.invalidateQueries({ queryKey: ["projects"] });
          if (event.projectId !== undefined) {
            void queryClient.invalidateQueries({ queryKey: ["project", event.projectId] });
          }
          break;
        case "session":
          void queryClient.invalidateQueries({ queryKey: ["sessions"] });
          if (event.sessionId !== undefined) {
            void queryClient.invalidateQueries({ queryKey: ["session", event.sessionId] });
          }
          if (event.projectId !== undefined) {
            void queryClient.invalidateQueries({ queryKey: ["project", event.projectId] });
          }
          break;
        case "session-change":
        case "review-comment":
          if (event.changeId !== undefined) {
            void queryClient.invalidateQueries({ queryKey: ["change", event.changeId] });
          }
          break;
        default:
          break;
      }
      onEvent?.(event);
    };
    return () => source.close();
  }, [onEvent]);
};

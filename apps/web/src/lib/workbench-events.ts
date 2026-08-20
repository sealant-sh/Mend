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
const LADDER_MS = [3_000, 4_000, 8_000, 16_000] as const;

export const useWorkbenchEvents = (onEvent?: (event: WorkbenchEventDto) => void) => {
  useEffect(() => {
    let source: EventSource | null = null;
    let timer: number | null = null;
    let attempt = 0;
    let disposed = false;

    const handleMessage = (message: MessageEvent<string>) => {
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
        case "session-process":
          if (event.sessionId !== undefined) {
            void queryClient.invalidateQueries({
              queryKey: ["session", event.sessionId, "services"],
            });
            void queryClient.invalidateQueries({
              queryKey: ["session", event.sessionId, "processes"],
            });
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

    // The browser retries transient drops on its own; CLOSED is permanent
    // (an expired session answering 401, a dead server) and silently freezes
    // every page that trusts this stream — so a closed source is replaced on
    // a backoff ladder, and immediately when the tab regains focus.
    const open = () => {
      if (disposed) return;
      const next = new EventSource("/api/events");
      source = next;
      next.addEventListener("open", () => {
        if (next !== source) return;
        attempt = 0;
      });
      next.addEventListener("message", handleMessage);
      next.addEventListener("error", () => {
        if (disposed || next !== source) return;
        if (next.readyState !== EventSource.CLOSED) return;
        next.close();
        const delay = LADDER_MS[Math.min(attempt, LADDER_MS.length - 1)];
        attempt += 1;
        timer = window.setTimeout(open, delay);
      });
    };
    const onFocus = () => {
      if (disposed) return;
      if (source !== null && source.readyState !== EventSource.CLOSED) return;
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      attempt = 0;
      open();
    };
    window.addEventListener("focus", onFocus);
    open();
    return () => {
      disposed = true;
      window.removeEventListener("focus", onFocus);
      if (timer !== null) window.clearTimeout(timer);
      source?.close();
    };
  }, [onEvent]);
};

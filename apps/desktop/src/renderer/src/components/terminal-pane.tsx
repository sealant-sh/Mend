import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ReplayScrubber } from "#/components/replay-scrubber";
import { StatusDot } from "#/components/status-dot";
import { TtyTerminal } from "#/components/tty-terminal";
import {
  checkpointSession,
  openReview,
  renameShell as renameShellProcess,
  stopSession,
  type SessionDto,
  type SessionProcessDto,
} from "#/lib/api";
import { queryClient, sessionDetailQuery } from "#/lib/queries";
import { reviewOpenKey, takeReplayCursor } from "#/lib/review";
import { isLive, statusTone, statusWord } from "#/lib/words";
import type { Tab } from "#/lib/workbench";

/**
 * The terminal (BRIEF.md): one dominant PTY for the focused tab, with a slim
 * header strip of facts and the two Mend actions. Session tabs show the agent
 * session's terminal — settled ones dim and grow the replay scrubber. Shell
 * tabs attach the mend shell's PTY in the bench workspace.
 */
export function TerminalPane({
  tab,
  session,
  process,
  onDetach,
  onReview,
}: {
  readonly tab: Tab;
  /** The visible session that owns this terminal and its worktree. */
  readonly session: SessionDto | null;
  /** Present for a supporting-shell tab. */
  readonly process: SessionProcessDto | null;
  /** Remove this view without stopping its process. */
  readonly onDetach: () => void;
  /** Enter native Review after the server returns the immutable slice. */
  readonly onReview: (changeId: string, sliceId: string) => void;
}) {
  const isSessionTab = tab.kind === "session";
  const detail = useQuery({
    ...sessionDetailQuery(tab.sessionId),
    enabled: isSessionTab,
  });
  const [from, setFrom] = useState(() => takeReplayCursor(tab.sessionId));
  const mark = useMutation({
    mutationFn: () => checkpointSession(tab.sessionId, "user-mark"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["session", tab.sessionId] }),
  });
  const stop = useMutation({
    mutationFn: () => stopSession(tab.sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["session", tab.sessionId] });
      if (session !== null) {
        void queryClient.invalidateQueries({ queryKey: ["project", session.projectId] });
      }
    },
  });
  const rename = useMutation({
    mutationFn: (label: string) =>
      process === null
        ? Promise.reject(new Error("shell process unavailable"))
        : renameShellProcess(process.id, label),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["session", tab.sessionId, "processes"] }),
  });

  const live = session !== null && isLive(session);
  const change = detail.data?.change ?? null;
  const review = useMutation({
    mutationFn: (changeId: string) => openReview(changeId, reviewOpenKey(changeId)),
    onSuccess: (opened) => onReview(opened.slice.changeId, opened.slice.id),
  });

  const quiet =
    "font-sans text-[12.5px] text-label hover:text-foreground disabled:opacity-40 disabled:hover:text-label";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-3 border-b border-rule bg-background px-3">
        {session !== null && isSessionTab && (
          <>
            <StatusDot
              tone={statusTone(session.status)}
              word={statusWord(session)}
              pulse={session.status === "running"}
            />
            <span className="truncate font-mono text-[12px] text-label">{session.branch}</span>
            <span className="flex-1" />
            {(mark.isError || review.isError) && (
              <span className="truncate font-mono text-[11.5px] text-danger">
                {mark.error instanceof Error
                  ? mark.error.message
                  : review.error instanceof Error
                    ? review.error.message
                    : "Review could not be opened"}
              </span>
            )}
            <button
              type="button"
              className={quiet}
              disabled={change === null || review.isPending}
              title={change === null ? "No change recorded yet" : "Open the pinned native Review"}
              onClick={() => {
                if (change !== null) review.mutate(change.id);
              }}
            >
              {review.isPending ? "opening Review…" : "review the change"}
            </button>
            <button
              type="button"
              className={quiet}
              disabled={!live || mark.isPending}
              onClick={() => mark.mutate()}
            >
              {mark.isPending ? "marking…" : "mark checkpoint"}
            </button>
            <button
              type="button"
              className={`${quiet} hover:text-danger`}
              disabled={!live || stop.isPending}
              onClick={() => stop.mutate()}
            >
              {stop.isPending ? "stopping…" : "stop"}
            </button>
          </>
        )}
        {!isSessionTab && (
          <>
            <span className="truncate font-mono text-[12px] text-label">
              {process?.label ?? "shell"} · session worktree
              {session === null ? "" : ` · ${session.branch}`}
            </span>
            <span className="flex-1" />
            {rename.isError && (
              <span className="truncate font-mono text-[11.5px] text-danger">
                {rename.error instanceof Error ? rename.error.message : "rename failed"}
              </span>
            )}
            <button
              type="button"
              className={quiet}
              disabled={process === null || rename.isPending}
              onClick={() => {
                const next = window.prompt("Shell name", process?.label ?? "shell");
                if (next !== null && next.trim() !== "") rename.mutate(next);
              }}
            >
              {rename.isPending ? "renaming…" : "rename"}
            </button>
            <button type="button" className={quiet} onClick={onDetach}>
              detach tab
            </button>
          </>
        )}
      </div>

      <div className="relative min-h-0 flex-1 bg-term">
        <TtyTerminal
          target={
            tab.kind === "shell"
              ? { kind: "process", id: tab.processId }
              : { kind: "session", id: tab.sessionId }
          }
          from={isSessionTab ? from : "0"}
          dim={isSessionTab && !live}
          focus
        />
      </div>

      {isSessionTab && session !== null && !live && (
        <ReplayScrubber checkpoints={detail.data?.checkpoints ?? []} from={from} onSeek={setFrom} />
      )}
    </div>
  );
}

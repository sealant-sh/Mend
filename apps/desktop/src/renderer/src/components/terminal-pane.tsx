import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ReplayScrubber } from "#/components/replay-scrubber";
import { StatusDot } from "#/components/status-dot";
import { TtyTerminal } from "#/components/tty-terminal";
import { checkpointSession, stopSession, type SessionDto } from "#/lib/api";
import { useConnection } from "#/lib/connection";
import { queryClient, sessionDetailQuery } from "#/lib/queries";
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
}: {
  readonly tab: Tab;
  /** The session behind the tab (the agent session, or the bench). */
  readonly session: SessionDto | null;
}) {
  const connection = useConnection();
  const isSessionTab = tab.kind === "session";
  const detail = useQuery({
    ...sessionDetailQuery(tab.sessionId),
    enabled: isSessionTab,
  });
  const [from, setFrom] = useState("0");
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

  const live = session !== null && isLive(session);
  const change = detail.data?.change ?? null;
  const reviewUrl =
    change !== null && connection !== null && connection.url !== ""
      ? `${connection.url.replace(/\/+$/, "")}/changes/${change.id}`
      : null;

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
            {mark.isError && (
              <span className="truncate font-mono text-[11.5px] text-danger">
                {mark.error instanceof Error ? mark.error.message : "checkpoint failed"}
              </span>
            )}
            <button
              type="button"
              className={quiet}
              disabled={reviewUrl === null}
              title={
                reviewUrl === null
                  ? "No change recorded yet"
                  : "Opens the web review (native review is M2)"
              }
              onClick={() => {
                if (reviewUrl !== null) void window.mend.shell.openExternal(reviewUrl);
              }}
            >
              review the change
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
            <span className="font-mono text-[12px] text-label">
              mend shell · bench workspace
              {session !== null ? ` · ${session.branch}` : ""}
            </span>
            <span className="flex-1" />
          </>
        )}
      </div>

      <div className="relative min-h-0 flex-1 bg-term">
        <TtyTerminal
          target={
            tab.kind === "shell" && tab.processId !== null
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

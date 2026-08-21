import { Button } from "@mend/ui/components/ui/button";
import { cn } from "@mend/ui/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { LogsView } from "#/components/logs-view";
import { ReplayScrubber } from "#/components/replay-scrubber";
import { StatusDot } from "#/components/status-dot";
import { TtyTerminal } from "#/components/tty-terminal";
import {
  checkpointSession,
  openReview,
  removeSession,
  renameShell as renameShellProcess,
  stopSession,
  type SessionDto,
  type SessionProcessDto,
  agentIsLive,
} from "#/lib/api";
import { queryClient, sessionDetailQuery } from "#/lib/queries";
import { reviewOpenKey, takeReplayCursor } from "#/lib/review";
import { statusTone, statusWord } from "#/lib/words";
import type { Tab } from "#/lib/workbench";

/** The header-strip action, composed from the ui Button at cockpit scale. */
function Quiet({ className, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className={cn("h-6 px-1.5 text-[12.5px] font-normal text-label", className)}
      {...props}
    />
  );
}

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
  serviceCount,
  serviceAttention,
  terminalFocusRequest,
  onServices,
  onDetach,
  onReview,
}: {
  readonly tab: Tab;
  /** The visible session that owns this terminal and its worktree. */
  readonly session: SessionDto | null;
  /** Present for a supporting-shell tab. */
  readonly process: SessionProcessDto | null;
  readonly serviceCount: number;
  readonly serviceAttention: boolean;
  readonly terminalFocusRequest: number;
  readonly onServices: () => void;
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
  const remove = useMutation({
    mutationFn: () => removeSession(tab.sessionId),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["session", tab.sessionId] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      if (session !== null) {
        void queryClient.invalidateQueries({ queryKey: ["project", session.projectId] });
      }
      onDetach();
    },
  });

  // The agent's own liveness, not the session fold: a shell holding the workspace keeps the
  // session `idle`, but this pane shows the AGENT's PTY — ended means replay and resume.
  const currentAgent = detail.data?.currentAgent ?? null;
  const live = session !== null && agentIsLive(session, currentAgent);
  const agentPty = currentAgent?.sealantSessionId ?? session?.sealantSessionId ?? null;
  const change = detail.data?.change ?? null;
  const review = useMutation({
    mutationFn: (changeId: string) => openReview(changeId, reviewOpenKey(changeId)),
    onSuccess: (opened) => onReview(opened.slice.changeId, opened.slice.id),
  });

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
            <Quiet onClick={onServices}>
              <span className={serviceAttention ? "text-warning" : ""}>
                Services {serviceCount}
              </span>
            </Quiet>
            {(mark.isError || review.isError) && (
              <span className="truncate font-mono text-[11.5px] text-danger">
                {mark.error instanceof Error
                  ? mark.error.message
                  : review.error instanceof Error
                    ? review.error.message
                    : "Review could not be opened"}
              </span>
            )}
            <Quiet
              disabled={change === null || review.isPending}
              title={change === null ? "No change recorded yet" : "Open the pinned native Review"}
              onClick={() => {
                if (change !== null) review.mutate(change.id);
              }}
            >
              {review.isPending ? "opening Review…" : "review the change"}
            </Quiet>
            <Quiet disabled={!live || mark.isPending} onClick={() => mark.mutate()}>
              {mark.isPending ? "marking…" : "mark checkpoint"}
            </Quiet>
            {live ? (
              <Quiet
                className="hover:text-danger"
                disabled={stop.isPending}
                onClick={() => stop.mutate()}
              >
                {stop.isPending ? "stopping…" : "stop"}
              </Quiet>
            ) : (
              <Quiet
                className="hover:text-danger"
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm("Really delete session and worktree?")) remove.mutate();
                }}
              >
                {remove.isPending ? "deleting…" : "delete"}
              </Quiet>
            )}
            {remove.isError && (
              <span className="truncate font-mono text-[11.5px] text-danger">
                {remove.error instanceof Error ? remove.error.message : "delete failed"}
              </span>
            )}
          </>
        )}
        {tab.kind === "logs" && (
          <>
            <span className="truncate font-mono text-[12px] text-label">
              {tab.name} · logs · read-only
              {session === null ? "" : ` · ${session.branch}`}
            </span>
            <span className="flex-1" />
            <Quiet onClick={onDetach}>close</Quiet>
          </>
        )}
        {tab.kind === "shell" && (
          <>
            <span className="truncate font-mono text-[12px] text-label">
              {process?.label ?? "shell"} · session worktree
              {session === null ? "" : ` · ${session.branch}`}
            </span>
            <span className="flex-1" />
            <Quiet onClick={onServices}>
              <span className={serviceAttention ? "text-warning" : ""}>
                Services {serviceCount}
              </span>
            </Quiet>
            {rename.isError && (
              <span className="truncate font-mono text-[11.5px] text-danger">
                {rename.error instanceof Error ? rename.error.message : "rename failed"}
              </span>
            )}
            <Quiet
              disabled={process === null || rename.isPending}
              onClick={() => {
                const next = window.prompt("Shell name", process?.label ?? "shell");
                if (next !== null && next.trim() !== "") rename.mutate(next);
              }}
            >
              {rename.isPending ? "renaming…" : "rename"}
            </Quiet>
            <Quiet onClick={onDetach}>detach tab</Quiet>
          </>
        )}
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col bg-term">
        {tab.kind === "logs" ? (
          <LogsView processId={tab.processId} />
        ) : isSessionTab && session !== null && agentPty === null && live ? (
          <p className="pointer-events-none absolute right-3 bottom-2 font-mono text-[11.5px] text-term-faint">
            provisioning workspace — the terminal attaches the moment the PTY is live (a first
            launch can take minutes)…
          </p>
        ) : (
          <TtyTerminal
            // The PTY handle is the attach identity: a session that was provisioning
            // (or one `mend continue` reopened) needs a fresh connection, not a retry.
            key={isSessionTab ? (agentPty ?? "none") : tab.processId}
            target={
              tab.kind === "shell"
                ? { kind: "process", id: tab.processId }
                : { kind: "session", id: tab.sessionId }
            }
            from={isSessionTab ? from : "0"}
            dim={isSessionTab && !live}
            focus
            focusRequest={terminalFocusRequest}
          />
        )}
      </div>

      {isSessionTab && session !== null && !live && (
        <ReplayScrubber checkpoints={detail.data?.checkpoints ?? []} from={from} onSeek={setFrom} />
      )}
    </div>
  );
}

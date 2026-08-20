import { useState } from "react";

import { Button } from "#/components/button";
import { createSession, launchArgv, launchSession, type SessionDto } from "#/lib/api";
import { useAppSettings } from "#/lib/app-settings";
import { queryClient } from "#/lib/queries";

/**
 * The launcher (BRIEF.md): pick a harness, go. `mend claude` as a button —
 * the CLI and the app produce identical sessions. A first launch on a cold
 * project builds the workspace image and can take minutes; the modal stays
 * up with the fact, not a spinner fiction.
 */

const HARNESSES = [
  { harness: "claude", hint: "Claude Code in a fresh worktree" },
  { harness: "codex", hint: "Codex in a fresh worktree" },
  { harness: "opencode", hint: "opencode in a fresh worktree" },
] as const;

export function Launcher({
  projectId,
  projectName,
  onLaunched,
  onClose,
}: {
  readonly projectId: string;
  readonly projectName: string;
  readonly onLaunched: (session: SessionDto) => void;
  readonly onClose: () => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { defaultHarness } = useAppSettings();
  const ordered = [...HARNESSES].toSorted((a, b) =>
    a.harness === defaultHarness ? -1 : b.harness === defaultHarness ? 1 : 0,
  );

  const launch = async (harness: string) => {
    setPending(harness);
    setError(null);
    try {
      const created = await createSession(projectId, harness, null);
      const launched = await launchSession(created.id, [...launchArgv(harness)]);
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      onLaunched(launched);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
      setPending(null);
    }
  };

  return (
    <div
      className="absolute inset-0 z-50 flex items-start justify-center bg-[rgba(27,27,29,0.28)] pt-[18vh]"
      onMouseDown={() => {
        if (pending === null) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-label={`New session in ${projectName}`}
        onMouseDown={(event) => event.stopPropagation()}
        className="no-drag w-[420px] overflow-hidden rounded-2xl border border-rule bg-panel shadow-overlay"
      >
        <p className="border-b border-rule px-4 py-3 font-sans text-[14px] font-medium text-foreground">
          New session · <span className="text-muted-foreground">{projectName}</span>
        </p>
        <ul className="py-1.5">
          {ordered.map(({ harness, hint }) => (
            <li key={harness}>
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => void launch(harness)}
                className="flex w-full items-baseline gap-3 px-4 py-2 text-left hover:bg-wash disabled:opacity-50"
              >
                <span className="w-20 font-mono text-[13.5px] text-foreground">{harness}</span>
                {harness === defaultHarness && (
                  <span className="font-mono text-[11px] text-faint">default</span>
                )}
                <span className="font-sans text-[13px] text-muted-foreground">
                  {pending === harness
                    ? "provisioning workspace — a first launch can take minutes…"
                    : hint}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {error !== null && (
          <p className="border-t border-rule px-4 py-2.5 font-mono text-[12px] text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end border-t border-rule px-3 py-2">
          <Button variant="ghost" disabled={pending !== null} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

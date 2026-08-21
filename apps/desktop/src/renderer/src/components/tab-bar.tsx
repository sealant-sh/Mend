import type { SessionDto, SessionProcessDto } from "#/lib/api";
import { sessionTitle } from "#/lib/words";
import type { Tab } from "#/lib/workbench";

/**
 * Numbered views for the focused project. Session tabs address coding-agent
 * PTYs; shell tabs address named supporting processes in those sessions.
 */
export function TabBar({
  tabs,
  focused,
  sessions,
  processes,
  opening,
  onFocus,
  onClose,
  onNewShell,
}: {
  readonly tabs: ReadonlyArray<Tab>;
  readonly focused: number;
  readonly sessions: ReadonlyMap<string, SessionDto>;
  readonly processes: ReadonlyMap<string, SessionProcessDto>;
  readonly opening: boolean;
  readonly onFocus: (index: number) => void;
  readonly onClose: (index: number) => void;
  readonly onNewShell: () => void;
}) {
  const title = (tab: Tab): string => {
    if (tab.kind === "shell") return processes.get(tab.processId)?.label ?? "shell";
    const session = sessions.get(tab.sessionId);
    return session === undefined ? "session" : sessionTitle(session);
  };
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-rule bg-background px-2">
      {tabs.map((tab, index) => {
        const active = index === focused;
        return (
          <div
            key={tab.kind === "session" ? `s:${tab.sessionId}` : `p:${tab.processId}`}
            className={`group/tab flex h-7 max-w-[220px] min-w-0 items-center gap-1.5 rounded-md pr-1 pl-2.5 ${
              active
                ? "bg-panel text-foreground shadow-xs ring-1 ring-[var(--sw-soft-rule)]"
                : "text-muted-foreground hover:bg-[var(--sw-sunken)] hover:text-foreground"
            }`}
          >
            <button
              type="button"
              onClick={() => onFocus(index)}
              className="flex min-w-0 items-center gap-1.5"
            >
              <span className="font-mono text-[11.5px] text-faint">{index + 1}</span>
              <span className="truncate font-sans text-[13px]">{title(tab)}</span>
            </button>
            <button
              type="button"
              aria-label={`Close tab ${index + 1}`}
              title={tab.kind === "shell" ? "Stop shell" : "Detach session tab"}
              onClick={() => onClose(index)}
              className="grid size-4 shrink-0 place-items-center rounded font-mono text-[12px] leading-none text-label opacity-0 transition-opacity group-hover/tab:opacity-100 hover:bg-[var(--sw-sunken)] hover:text-foreground focus-visible:opacity-100"
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={onNewShell}
        disabled={opening}
        title="New shell in focused session (Ctrl+Shift+T)"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md font-mono text-[15px] leading-none text-label hover:bg-[var(--sw-sunken)] hover:text-foreground disabled:opacity-50"
      >
        {opening ? "…" : "+"}
      </button>
    </div>
  );
}

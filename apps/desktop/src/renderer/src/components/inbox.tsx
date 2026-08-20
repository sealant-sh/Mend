import { useEffect, useState } from "react";

import { toneText } from "#/components/status-dot";
import type { Inbox, InboxRow } from "#/lib/model";
import { ago } from "#/lib/words";

/**
 * The inbox — t3code's sidebar model, adapted (BRIEF.md §inbox). Static
 * creation order, newest first; activity never reorders a row. Attention is
 * contrast: a colored word in the status slot (input / working / failed /
 * done), full opacity and medium weight for rows that need a human, receded
 * opacity for rows that don't. The Settled shelf collapses; holding Ctrl
 * paints 1..9 jump pills on the first nine rows.
 */

const SETTLED_SHOWN = 10;
const SETTLED_PAGE = 25;

function Row({
  row,
  index,
  focused,
  now,
  showJumpHints,
  onFocus,
}: {
  readonly row: InboxRow;
  readonly index: number;
  readonly focused: boolean;
  readonly now: number;
  readonly showJumpHints: boolean;
  readonly onFocus: () => void;
}) {
  const slim = row.section === "settled";
  const time = ago(
    row.section === "settled"
      ? (row.session.settledAt ?? row.session.createdAt)
      : (row.session.startedAt ?? row.session.createdAt),
    now,
  );
  return (
    <li className="relative">
      <button
        type="button"
        onClick={onFocus}
        aria-current={focused ? "true" : undefined}
        className={`flex w-full flex-col gap-[2px] rounded-md px-3 text-left transition-colors ${
          slim ? "py-[5px]" : "py-2"
        } ${
          focused
            ? "bg-wash"
            : row.recede
              ? "opacity-70 hover:bg-[var(--sw-sunken)] hover:opacity-100"
              : "hover:bg-[var(--sw-sunken)]"
        }`}
      >
        <span className="flex w-full items-baseline gap-2">
          <span
            className={`min-w-0 flex-1 truncate font-sans text-[13.5px] ${
              row.unseen ? "font-medium text-foreground" : "font-normal text-ink-2"
            }`}
          >
            {row.title}
          </span>
          <span
            className={`shrink-0 ${
              row.slot === null
                ? "font-mono text-[11.5px] text-faint"
                : `font-sans text-[12px] font-medium ${toneText(row.slot.tone)}`
            }`}
          >
            {row.slot?.word ?? time ?? ""}
          </span>
        </span>
        {!slim && (
          <span className="truncate font-mono text-[11.5px] text-label">
            {row.projectName} · {row.session.branch}
          </span>
        )}
      </button>
      {showJumpHints && index < 9 && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded-md border border-rule bg-panel px-1.5 font-mono text-[11.5px] text-muted-foreground shadow-xs"
        >
          {index + 1}
        </span>
      )}
    </li>
  );
}

export function InboxRail({
  inbox,
  focusedSessionId,
  now,
  onFocus,
}: {
  readonly inbox: Inbox;
  readonly focusedSessionId: string | null;
  readonly now: number;
  readonly onFocus: (row: InboxRow) => void;
}) {
  const [settledExpanded, setSettledExpanded] = useState(true);
  const [settledShown, setSettledShown] = useState(SETTLED_SHOWN);
  const [jumpHints, setJumpHints] = useState(false);

  // Hold-Ctrl index overlay, t3's JumpHintBadge: only while the exact jump
  // modifier is down, so Ctrl+Shift combos don't flash the pills.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key === "Control" && !event.shiftKey && !event.altKey && !event.metaKey) {
        setJumpHints(true);
      } else if (event.key !== "Control") {
        setJumpHints(false);
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.key === "Control") setJumpHints(false);
    };
    const blur = () => setJumpHints(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const shownSettled = settledExpanded ? inbox.settled.slice(0, settledShown) : [];

  return (
    <div className="flex min-h-0 flex-col border-t border-rule">
      <p className="px-4 pt-3 pb-1.5 font-mono text-[11.5px] tracking-[0.6px] text-muted-foreground uppercase">
        inbox
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {inbox.active.length === 0 && (
          <p className="px-2.5 py-1 font-sans text-[12.5px] text-label">no live sessions</p>
        )}
        <ul>
          {inbox.active.map((row, index) => (
            <Row
              key={row.session.id}
              row={row}
              index={index}
              focused={row.session.id === focusedSessionId}
              now={now}
              showJumpHints={jumpHints}
              onFocus={() => onFocus(row)}
            />
          ))}
        </ul>
        {inbox.settled.length > 0 && (
          <button
            type="button"
            onClick={() => setSettledExpanded((v) => !v)}
            aria-expanded={settledExpanded}
            className="mt-1 w-full px-2.5 py-1 text-left font-sans text-[12px] text-label hover:text-foreground"
          >
            {settledExpanded ? "settled" : `settled (${inbox.settled.length})`}
          </button>
        )}
        {settledExpanded && (
          <ul>
            {shownSettled.map((row, index) => (
              <Row
                key={row.session.id}
                row={row}
                index={inbox.active.length + index}
                focused={row.session.id === focusedSessionId}
                now={now}
                showJumpHints={jumpHints}
                onFocus={() => onFocus(row)}
              />
            ))}
          </ul>
        )}
        {settledExpanded && inbox.settled.length > settledShown && (
          <button
            type="button"
            onClick={() => setSettledShown((v) => v + SETTLED_PAGE)}
            className="w-full px-2.5 py-1 text-left font-sans text-[12px] text-label hover:text-foreground"
          >
            show {Math.min(SETTLED_PAGE, inbox.settled.length - settledShown)} more
          </button>
        )}
      </div>
    </div>
  );
}

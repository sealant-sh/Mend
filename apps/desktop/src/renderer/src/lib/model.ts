import { LIVE_STATUSES, type ProjectDto, type SessionDto } from "#/lib/api";
import type { InboxShelves } from "#/lib/inbox-shelves";
import { hasUnseenSettle } from "#/lib/seen";
import { effectiveSnoozed, type Snoozes } from "#/lib/snooze";
import { sessionTitle, type Tone } from "#/lib/words";

/**
 * The inbox, on t3code's sidebar model (studied at nightly 20260821.1150,
 * MIT — ~/Developer/refs/t3code, map in apps/desktop/docs/SIDEBAR-MAP.md): a
 * FLAT list in static creation order, newest first. Activity never reorders
 * a row — position only changes at lifecycle transitions: a session settling
 * drops to the Settled shelf (ordered by when work ENDED), a snooze parks it
 * on the Snoozed shelf (ordered by when it comes back). Attention is carried
 * by contrast, not position: a colored status word, full opacity for rows
 * that need a human, receded opacity for rows that don't — in-flight rows
 * recede too; working isn't your problem yet.
 *
 * Mend mapping: agent sessions only (shells are you, not agents — they never
 * appear). Snoozed outranks everything; then Active = live statuses; Settled
 * = the rest. The status slot is a mutually-exclusive cascade; "done" shows
 * only while a settle is unseen (see lib/seen.ts).
 */

export type InboxSection = "active" | "snoozed" | "settled";

export interface InboxRow {
  readonly session: SessionDto;
  readonly projectName: string;
  readonly title: string;
  readonly section: InboxSection;
  /** Wake time (ISO) for a snoozed row — its whole story on the shelf. */
  readonly wakeAt: string | null;
  /** The one thing the status slot says; null = show the timestamp instead. */
  readonly slot: { readonly word: string; readonly tone: Tone } | null;
  /** Rows that need nobody recede (t3: opacity, not position). */
  readonly recede: boolean;
  /** Title weight carries unseen, like t3's font-medium. */
  readonly unseen: boolean;
}

export interface Inbox {
  readonly active: ReadonlyArray<InboxRow>;
  readonly snoozed: ReadonlyArray<InboxRow>;
  readonly settled: ReadonlyArray<InboxRow>;
  /** Flat order — active, snoozed, settled — for the palette and search. */
  readonly ordered: ReadonlyArray<InboxRow>;
}

/** Coding-agent sessions are the inbox material. */
export const isAgentSession = (session: SessionDto): boolean => session.harness !== "shell";

/** Retired hidden benches remain visible until their change and processes are resolved. */
export const isLegacyBench = (session: SessionDto): boolean =>
  session.harness === "shell" && session.label === "bench";

const isTreeSession = (session: SessionDto): boolean =>
  isAgentSession(session) || isLegacyBench(session);

const settledAt = (session: SessionDto): number => {
  const at = session.settledAt ?? session.createdAt;
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? 0 : ms;
};

const createdAt = (session: SessionDto): number => {
  const ms = Date.parse(session.createdAt);
  return Number.isNaN(ms) ? 0 : ms;
};

const unexpectedStatus = (status: never): never => {
  throw new Error(`Unhandled session status: ${String(status)}`);
};

const slotFor = (
  session: SessionDto,
  unseen: boolean,
): { readonly word: string; readonly tone: Tone } | null => {
  switch (session.status) {
    case "waiting":
      return { word: "input", tone: "amber" };
    case "running":
    case "starting":
      return { word: "working", tone: "accent" };
    case "failed":
      return { word: "failed", tone: "red" };
    case "completed":
    case "stopped":
      return unseen ? { word: "done", tone: "green" } : null;
    case "idle":
      return null;
    default:
      return unexpectedStatus(session.status);
  }
};

const byId = (a: InboxRow, b: InboxRow) => a.session.id.localeCompare(b.session.id);

const wakeAtMs = (row: InboxRow): number => {
  const ms = row.wakeAt === null ? Number.NaN : Date.parse(row.wakeAt);
  return Number.isNaN(ms) ? 0 : ms;
};

export const buildInbox = (
  projects: ReadonlyArray<{
    readonly project: ProjectDto;
    readonly sessions: ReadonlyArray<SessionDto>;
  }>,
  visited: Record<string, string>,
  snoozes: Snoozes = {},
  now: number = Date.now(),
): Inbox => {
  const rows: Array<InboxRow> = [];
  for (const { project, sessions } of projects) {
    for (const session of sessions) {
      if (!isAgentSession(session)) continue;
      const live = LIVE_STATUSES.has(session.status);
      const unseen = !live && hasUnseenSettle(visited, session.id, session.settledAt);
      const slot = slotFor(session, unseen);
      const entry = snoozes[session.id];
      const snoozed = effectiveSnoozed(session, entry, now);
      rows.push({
        session,
        projectName: project.name,
        title: sessionTitle(session),
        section: snoozed ? "snoozed" : live ? "active" : "settled",
        wakeAt: snoozed && entry !== undefined ? entry.until : null,
        slot,
        // t3: in-flight rows recede the same as read-ready ones — working
        // isn't your problem yet. Only input/failed/unseen hold full weight.
        recede: !unseen && session.status !== "waiting" && session.status !== "failed",
        unseen,
      });
    }
  }
  // Static creation order, newest on top; the settled shelf orders by when
  // the work ended; the snoozed shelf by what comes back first. Ties break on
  // id so the list never jitters.
  const active = rows
    .filter((r) => r.section === "active")
    .toSorted((a, b) => createdAt(b.session) - createdAt(a.session) || byId(a, b));
  const snoozed = rows
    .filter((r) => r.section === "snoozed")
    .toSorted((a, b) => wakeAtMs(a) - wakeAtMs(b) || byId(a, b));
  const settled = rows
    .filter((r) => r.section === "settled")
    .toSorted((a, b) => settledAt(b.session) - settledAt(a.session) || byId(a, b));
  return { active, snoozed, settled, ordered: [...active, ...snoozed, ...settled] };
};

/** The inbox narrowed to one project — a scope filter over the already-ordered list (t3: Sidebar.tsx 1921-1946). */
export const scopeInbox = (inbox: Inbox, projectId: string | null): Inbox => {
  if (projectId === null) return inbox;
  const keep = (row: InboxRow) => row.session.projectId === projectId;
  return {
    active: inbox.active.filter(keep),
    snoozed: inbox.snoozed.filter(keep),
    settled: inbox.settled.filter(keep),
    ordered: inbox.ordered.filter(keep),
  };
};

/**
 * The rows the rail actually renders, in the order it numbers them: active,
 * then the snoozed shelf when open, then the settled tail as far as paging
 * shows — and always the focused row, even behind a collapsed shelf or
 * below the cut, so a focused session never vanishes from the rail.
 */
export const visibleInboxRows = (
  inbox: Inbox,
  shelves: InboxShelves,
  focusedSessionId: string | null,
): ReadonlyArray<InboxRow> => {
  const focused = (row: InboxRow) => row.session.id === focusedSessionId;
  const snoozed = shelves.snoozedExpanded ? inbox.snoozed : inbox.snoozed.filter(focused);
  const settled = shelves.settledExpanded
    ? inbox.settled.filter((row, index) => index < shelves.settledShown || focused(row))
    : inbox.settled.filter(focused);
  return [...inbox.active, ...snoozed, ...settled];
};

/** The project tree: coding-agent sessions plus migration-only legacy benches. */
export interface TreeProject {
  readonly project: ProjectDto;
  readonly sessions: ReadonlyArray<SessionDto>;
}

export const buildTree = (
  projects: ReadonlyArray<{
    readonly project: ProjectDto;
    readonly sessions: ReadonlyArray<SessionDto>;
  }>,
): ReadonlyArray<TreeProject> =>
  projects.map(({ project, sessions }) => ({
    project,
    sessions: sessions
      .filter(isTreeSession)
      .toSorted(
        (a: SessionDto, b: SessionDto) => createdAt(b) - createdAt(a) || a.id.localeCompare(b.id),
      ),
  }));

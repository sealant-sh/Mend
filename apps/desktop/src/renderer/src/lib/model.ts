import { LIVE_STATUSES, type ProjectDto, type SessionDto } from "#/lib/api";
import { hasUnseenSettle } from "#/lib/seen";
import { sessionTitle, type Tone } from "#/lib/words";

/**
 * The inbox, on t3code's sidebar model (studied at nightly 20260819.1133,
 * MIT — ~/Developer/refs/t3code): a FLAT list in static creation order,
 * newest first. Activity never reorders a row — position only changes at
 * lifecycle transitions (a session settling drops to the Settled shelf,
 * ordered by when work ENDED). Attention is carried by contrast, not
 * position: a colored status word, full opacity for rows that need a human,
 * receded opacity for rows that don't.
 *
 * Mend mapping: agent sessions only (shells are you, not agents — they never
 * appear). Active = live statuses; Settled = the rest. The status slot is a
 * mutually-exclusive cascade; "done" shows only while a settle is unseen
 * (see lib/seen.ts).
 */

export interface InboxRow {
  readonly session: SessionDto;
  readonly projectName: string;
  readonly title: string;
  readonly section: "active" | "settled";
  /** The one thing the status slot says; null = show the timestamp instead. */
  readonly slot: { readonly word: string; readonly tone: Tone } | null;
  /** Rows that need nobody recede (t3: opacity, not position). */
  readonly recede: boolean;
  /** Title weight carries unseen, like t3's font-medium. */
  readonly unseen: boolean;
}

export interface Inbox {
  readonly active: ReadonlyArray<InboxRow>;
  readonly settled: ReadonlyArray<InboxRow>;
  /** Flat jump order — active then settled — for mod+1..9 and next/prev. */
  readonly ordered: ReadonlyArray<InboxRow>;
}

/** Agent sessions only: the bench and its shells are not inbox material. */
export const isAgentSession = (session: SessionDto): boolean => session.harness !== "shell";

const settledAt = (session: SessionDto): number => {
  const at = session.settledAt ?? session.createdAt;
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? 0 : ms;
};

const createdAt = (session: SessionDto): number => {
  const ms = Date.parse(session.createdAt);
  return Number.isNaN(ms) ? 0 : ms;
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
  }
};

export const buildInbox = (
  projects: ReadonlyArray<{
    readonly project: ProjectDto;
    readonly sessions: ReadonlyArray<SessionDto>;
  }>,
  visited: Record<string, string>,
): Inbox => {
  const rows: Array<InboxRow> = [];
  for (const { project, sessions } of projects) {
    for (const session of sessions) {
      if (!isAgentSession(session)) continue;
      const live = LIVE_STATUSES.has(session.status);
      const unseen = !live && hasUnseenSettle(visited, session.id, session.settledAt);
      const slot = slotFor(session, unseen);
      rows.push({
        session,
        projectName: project.name,
        title: sessionTitle(session),
        section: live ? "active" : "settled",
        slot,
        // t3: in-flight rows recede the same as read-ready ones — working
        // isn't your problem yet. Only input/failed/unseen hold full weight.
        recede: !unseen && session.status !== "waiting" && session.status !== "failed",
        unseen,
      });
    }
  }
  // Static creation order, newest on top; the settled shelf orders by when
  // the work ended. Ties break on id so the list never jitters.
  const active = rows
    .filter((r) => r.section === "active")
    .toSorted(
      (a, b) =>
        createdAt(b.session) - createdAt(a.session) || a.session.id.localeCompare(b.session.id),
    );
  const settled = rows
    .filter((r) => r.section === "settled")
    .toSorted(
      (a, b) =>
        settledAt(b.session) - settledAt(a.session) || a.session.id.localeCompare(b.session.id),
    );
  return { active, settled, ordered: [...active, ...settled] };
};

/** The project tree: every project, its agent sessions beneath. */
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
      .filter(isAgentSession)
      .toSorted((a, b) => createdAt(b) - createdAt(a) || a.id.localeCompare(b.id)),
  }));

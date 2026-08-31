import { CliRenderEvents, createCliRenderer, type ScrollBoxRenderable } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  deriveHarnesses,
  deriveProjects,
  type BranchDto,
  deriveRows,
  deriveWorktrees,
  filterBranches,
  foldGroupStatus,
  labelIsIdentity,
  rowKeyOf,
  worktreeDisplayName,
  fetchWorkbench,
  type HarnessItem,
  liveShellOf,
  mapWorkbenchSessions,
  markSessionStopped,
  removeWorktreeGroup,
  prependSession,
  removeSession,
  replaceSession,
  WORKBENCH_KEY,
  type ProjectItem,
  type SelectableRow,
  type ServiceDto,
  type SessionDto,
  type SessionItem,
  type SessionProcessDto,
  type Workbench,
  type WorktreeGroup,
} from "./dashboard-model.ts";
import { reviewTargetForSession } from "./review-workflow.ts";
import { ReviewScreen } from "./review.tsx";
import {
  cwdFacts,
  HARNESS_COMMANDS,
  isPendingId,
  LIVE_STATUSES,
  matchProjectByCwd,
  normalizeProjectName,
  pendingId,
} from "./shared.ts";
import { openUrl } from "./terminal.ts";
import { COBALT, FAINT, INK, INK_2, MUTED, RED, RULE, WASH } from "./tui-theme.ts";

// Near-mono on purpose: a status is a word, and only an observed failure
// earns color. Live states read at full ink; settled ones recede.
const STATUS_COLOR: Record<string, string> = {
  starting: INK_2,
  running: INK,
  waiting: INK_2,
  idle: INK_2,
  completed: FAINT,
  failed: RED,
  stopped: FAINT,
};

const timeAgo = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

import { createSseParser, eventFamilies, type InvalidateFamily } from "./workbench-events.ts";

/**
 * The workbench dashboard (bare `mend`): a drawn multi-pane interface —
 * projects pane and sessions pane side by side, a session detail panel
 * beneath them, and the harness picker as a panel that takes the detail
 * slot. Focus moves between panes (tab, h/l); the cobalt border says which
 * pane the keyboard is in. Rendered with @opentui/react.
 *
 * Server state lives in one TanStack Query cache entry; the SSE stream (the
 * same one the web app uses) is parsed outside React and each pointer event
 * invalidates only the query families it can stale — heartbeats and
 * per-record-line progress invalidate nothing. Writes are optimistic
 * mutations: a rename, a new session, a resume all land in the cache
 * immediately and the server's answer reconciles on settle, so the keyboard
 * never waits on a round trip.
 *
 * This module is imported lazily and only where node:ffi exists (Node 26
 * with --experimental-ffi — main.ts gates and re-execs), so every plain
 * command keeps running dependency-free on Node >= 22.
 */

export interface DashboardContext {
  readonly config: { readonly url: string; readonly token: string | null };
  /** Where the dashboard was opened — resolves the starting project. */
  readonly cwd: string;
  /** Server request that THROWS on failure (never exits) — the status line renders it. */
  readonly api: <T>(method: "GET" | "POST" | "DELETE", route: string, body?: unknown) => Promise<T>;
  /** The PTY bridge; resolves when the session settles or the user detaches. */
  readonly attachTty: (
    sessionId: string,
    harness: string,
    processId?: string,
  ) => Promise<"detached" | "ended" | "dropped" | "interrupted" | "unavailable">;
}

// ─── panes and rows ─────────────────────────────────────────────────────────

const Gutter = ({ selected }: { readonly selected: boolean }) => (
  <span fg={selected ? COBALT : FAINT}>{selected ? "▌ " : "  "}</span>
);

/**
 * A drawn pane: rounded border, a title in the frame, cobalt when the
 * keyboard lives here. Everything the dashboard shows sits in one of these.
 */
const Pane = ({
  title,
  focused,
  children,
  width,
  height,
  grow,
}: {
  readonly title: string;
  readonly focused: boolean;
  readonly children: ReactNode;
  readonly width?: number;
  readonly height?: number;
  readonly grow?: boolean;
}) => (
  <box
    border
    borderStyle="rounded"
    borderColor={focused ? COBALT : RULE}
    title={` ${title} `}
    titleAlignment="left"
    backgroundColor="transparent"
    {...(width === undefined ? {} : { width, flexShrink: 0, minHeight: 0 })}
    {...(height === undefined ? {} : { height, flexShrink: 0 })}
    {...(grow === true ? { flexGrow: 1, flexShrink: 1, minHeight: 0, minWidth: 0 } : {})}
    flexDirection="column"
  >
    {children}
  </box>
);

const paneScrollStyle = {
  rootOptions: { backgroundColor: "transparent", border: false },
  wrapperOptions: { backgroundColor: "transparent" },
  viewportOptions: { backgroundColor: "transparent" },
  contentOptions: { backgroundColor: "transparent" },
} as const;

const ProjectRow = ({
  item,
  selected,
  nameWidth,
}: {
  readonly item: ProjectItem;
  readonly selected: boolean;
  readonly nameWidth: number;
}) => (
  <box height={1} flexShrink={0} backgroundColor={selected ? WASH : "transparent"}>
    <text height={1} bg="transparent">
      <Gutter selected={selected} />
      <span fg={INK}>{item.project.name.padEnd(nameWidth)}</span>
      <span fg={item.total === 0 ? FAINT : MUTED}>{`  ${item.total}`}</span>
      {item.live > 0 ? <span fg={MUTED}>{` · ${item.live} live`}</span> : null}
      {item.open > 0 ? <span fg={MUTED}>{` · ${item.open}`}</span> : null}
    </text>
  </box>
);

const ProcessLines = ({
  processes,
  services,
  indent,
}: {
  readonly processes: ReadonlyArray<SessionProcessDto>;
  readonly services: ReadonlyArray<ServiceDto>;
  readonly indent: string;
}) => (
  <>
    {processes.map((process) => (
      <box key={process.id} height={1} flexShrink={0} backgroundColor="transparent">
        <text height={1} bg="transparent">
          <span fg={FAINT}>{indent}</span>
          <span fg={INK_2}>
            {process.kind === "shell"
              ? (process.label ?? "shell")
              : (process.harness ?? process.kind)}
          </span>
          <span fg={FAINT}>
            {process.kind === "agent-protocol"
              ? " · protocol"
              : process.kind === "agent-external"
                ? " · external"
                : ""}
            {` ${process.status}`}
          </span>
        </text>
      </box>
    ))}
    {services.map((service) => (
      <box key={service.id} height={1} flexShrink={0} backgroundColor="transparent">
        <text height={1} bg="transparent">
          <span fg={FAINT}>{indent}</span>
          <span fg={service.status === "reachable" ? INK_2 : MUTED}>
            {`${service.label ?? service.id.slice(0, 6)} :${service.workspacePort ?? "?"}${service.protocol === "udp" ? "u" : ""}→${service.hostPort ?? "?"}`}
          </span>
          <span fg={FAINT}>{` ${service.status}`}</span>
        </text>
      </box>
    ))}
  </>
);

/**
 * A lone-session worktree, combined into one row (today's density): the
 * worktree name leads, everything live inside hangs underneath as facts.
 */
const CombinedRow = ({
  group,
  item,
  selected,
}: {
  readonly group: WorktreeGroup;
  readonly item: SessionItem;
  readonly selected: boolean;
}) => {
  const { session, annotation, services, processes } = item;
  const color = STATUS_COLOR[session.status] ?? MUTED;
  const age = timeAgo(session.createdAt).replace(" ago", "");
  const trailingLabel = labelIsIdentity(session) ? "" : (session.label ?? "");
  return (
    <box flexShrink={0} flexDirection="column" backgroundColor="transparent">
      <box height={1} flexShrink={0} backgroundColor={selected ? WASH : "transparent"}>
        <text height={1} bg="transparent">
          <Gutter selected={selected} />
          <span fg={INK}>{group.name.slice(0, 30).padEnd(31)}</span>
          <span fg={color}>{session.status.padEnd(10)}</span>
          <span fg={FAINT}>{age.padEnd(9)}</span>
          <span fg={MUTED}>{session.harness.padEnd(10)}</span>
          {annotation !== undefined && annotation.openComments > 0 ? (
            <span fg={MUTED}>{`${annotation.openComments} open  `}</span>
          ) : null}
          <span fg={FAINT}>{trailingLabel.slice(0, 40)}</span>
        </text>
      </box>
      <ProcessLines processes={processes} services={services} indent={"     └ "} />
    </box>
  );
};

/** A shared worktree's header: the place, its folded status, its member facts. */
const WorktreeHeaderRow = ({
  group,
  selected,
}: {
  readonly group: WorktreeGroup;
  readonly selected: boolean;
}) => {
  const folded = foldGroupStatus(group);
  const color = group.live > 0 ? (STATUS_COLOR[folded] ?? MUTED) : FAINT;
  const age = timeAgo(group.sessions.at(-1)?.session.createdAt ?? group.createdAt).replace(
    " ago",
    "",
  );
  const open = group.annotation?.openComments ?? 0;
  return (
    <box height={1} flexShrink={0} backgroundColor={selected ? WASH : "transparent"}>
      <text height={1} bg="transparent">
        <Gutter selected={selected} />
        <span fg={INK}>{group.name.slice(0, 30).padEnd(31)}</span>
        <span fg={color}>{(group.live > 0 ? folded : "settled").padEnd(10)}</span>
        <span fg={FAINT}>{age.padEnd(9)}</span>
        <span fg={MUTED}>{`${group.sessions.length} sessions`}</span>
        {open > 0 ? <span fg={MUTED}>{` · ${open} open`}</span> : null}
      </text>
    </box>
  );
};

/** One conversation inside a shared worktree — the label is its identity. */
const SessionChildRow = ({
  item,
  selected,
}: {
  readonly item: SessionItem;
  readonly selected: boolean;
}) => {
  const { session, services, processes } = item;
  const color = STATUS_COLOR[session.status] ?? MUTED;
  const age = timeAgo(session.createdAt).replace(" ago", "");
  const name = session.label ?? `session ${session.id.slice(0, 8)}`;
  return (
    <box flexShrink={0} flexDirection="column" backgroundColor="transparent">
      <box height={1} flexShrink={0} backgroundColor={selected ? WASH : "transparent"}>
        <text height={1} bg="transparent">
          <Gutter selected={selected} />
          <span fg={FAINT}>{"  └ "}</span>
          <span fg={INK}>{name.slice(0, 26).padEnd(27)}</span>
          <span fg={color}>{session.status.padEnd(10)}</span>
          <span fg={FAINT}>{age.padEnd(9)}</span>
          <span fg={MUTED}>{session.harness.padEnd(10)}</span>
        </text>
      </box>
      <ProcessLines processes={processes} services={services} indent={"       └ "} />
    </box>
  );
};

const HarnessRow = ({
  item,
  selected,
}: {
  readonly item: HarnessItem;
  readonly selected: boolean;
}) => (
  <box height={1} flexShrink={0} backgroundColor={selected ? WASH : "transparent"}>
    <text height={1} bg="transparent">
      <Gutter selected={selected} />
      <span fg={INK}>{item.label.padEnd(12)}</span>
      <span fg={FAINT}>{item.hint}</span>
    </text>
  </box>
);

/**
 * The detail panel: everything about the selected session that the one-line
 * rows no longer carry — branch and base, services, the review state, the
 * summary. The panes above stay scannable because this panel holds the depth.
 */
const SessionDetail = ({ item }: { readonly item: SessionItem | null }) => {
  if (item === null) {
    return (
      <text height={1} bg="transparent" fg={FAINT}>
        {"  no session selected — n starts one"}
      </text>
    );
  }
  const { session, annotation, services } = item;
  const color = STATUS_COLOR[session.status] ?? MUTED;
  const summary = session.summary?.split("\n")[0] ?? null;
  return (
    <>
      <text height={1} bg="transparent">
        <span>{"  "}</span>
        <span fg={color}>{session.status}</span>
        <span fg={FAINT}> · </span>
        <span fg={MUTED}>{session.branch}</span>
        <span fg={FAINT}>
          {session.baseSha === "" ? "" : ` vs ${session.baseRef ?? session.baseSha.slice(0, 12)}`} ·
          started {timeAgo(session.createdAt)}
        </span>
      </text>
      <text height={1} bg="transparent">
        <span>{"  "}</span>
        {services.length === 0 ? (
          <span fg={FAINT}>no services running</span>
        ) : (
          services.slice(0, 3).map((service, index) => (
            <span key={service.id}>
              {index > 0 ? <span fg={FAINT}> · </span> : null}
              <span fg={service.status === "reachable" ? INK_2 : MUTED}>
                {`${service.label ?? service.id.slice(0, 6)} :${service.workspacePort ?? "?"}${service.protocol === "udp" ? "u" : ""}→${service.hostPort ?? "?"} ${service.status}`}
              </span>
            </span>
          ))
        )}
        {services.length > 3 ? <span fg={FAINT}>{` · +${services.length - 3} more`}</span> : null}
      </text>
      <text height={1} bg="transparent">
        <span>{"  "}</span>
        {annotation === undefined || annotation.openComments === 0 ? (
          <span fg={FAINT}>no open review comments</span>
        ) : (
          <span fg={INK_2}>
            {annotation.openComments} open comment{annotation.openComments === 1 ? "" : "s"}
          </span>
        )}
        {annotation?.pendingFollowUp === true ? (
          <>
            <span fg={FAINT}> · </span>
            <span fg={INK_2}>follow-up pending</span>
          </>
        ) : null}
        {annotation?.changeId != null ? (
          <>
            <span fg={FAINT}> · </span>
            <span fg={MUTED}>v reviews the change</span>
          </>
        ) : null}
      </text>
      <text height={1} bg="transparent" fg={summary === null ? FAINT : MUTED}>
        {`  ${summary ?? "no summary yet"}`}
      </text>
    </>
  );
};

// ─── status line: busy ticker or auto-clearing message ──────────────────────

interface StatusMessage {
  readonly text: string;
  readonly at: number;
}

const StatusLine = ({
  busy,
  busyStarted,
  status,
}: {
  readonly busy: string | null;
  readonly busyStarted: number;
  readonly status: StatusMessage | null;
}) => {
  const [now, setNow] = useState(() => Date.now());
  // Timers are the one thing React cannot express declaratively: a 1s tick
  // while busy, and one repaint to clear an expired status message.
  useEffect(() => {
    if (busy !== null) {
      const timer = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(timer);
    }
    if (status !== null) {
      const timer = setTimeout(() => setNow(Date.now()), 5100);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [busy, status]);
  const text =
    busy !== null
      ? ` ${busy} ${Math.max(0, Math.round((now - busyStarted) / 1000))}s`
      : status !== null && Date.now() - status.at < 5000
        ? ` ${status.text}`
        : "";
  return (
    <text height={1} fg={INK_2} bg="transparent">
      {text}
    </text>
  );
};

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Keep a 1-line-per-row selection inside its scrollbox's real viewport. */
const keepSpanVisible = (scroll: ScrollBoxRenderable | null, top: number, height: number): void => {
  if (scroll === null) return;
  const viewH = Math.max(1, scroll.viewport.height);
  if (top < scroll.scrollTop) scroll.scrollTo(top);
  else if (top + height > scroll.scrollTop + viewH) scroll.scrollTo(top + height - viewH);
};

const keepRowVisible = (scroll: ScrollBoxRenderable | null, index: number): void =>
  keepSpanVisible(scroll, index, 1);

// ─── the app ────────────────────────────────────────────────────────────────

type Focus = "projects" | "sessions";

const PROJECTS_PANE_WIDTH = 30;

const App = ({ ctx, onQuit }: { readonly ctx: DashboardContext; readonly onQuit: () => void }) => {
  const renderer = useRenderer();
  const queryClient = useQueryClient();
  const { data, failureReason } = useQuery({
    queryKey: WORKBENCH_KEY,
    queryFn: () => fetchWorkbench(ctx),
    // A dev server mid-restart is normal: keep trying, once a second.
    retry: true,
    retryDelay: 1000,
  });

  const [focusState, setFocus] = useState<Focus>("sessions");
  const [projectKey, setProjectKey] = useState<string | null>(null);
  /** A row key (`wt:<id>` | `s:<id>`), so selection survives regrouping. */
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [picker, setPicker] = useState<{
    readonly session: SessionDto | null;
    /** Set when the picker opens a NEW conversation inside this worktree. */
    readonly worktree?: WorktreeGroup;
  } | null>(null);
  const [pickerIndex, setPickerIndex] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [busyStarted, setBusyStarted] = useState(0);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [editing, setEditing] = useState<SessionDto | null>(null);
  /** Session id a stop is armed against; the second press fires it. */
  const [stopArmed, setStopArmed] = useState<string | null>(null);
  /** The new-session flow asks the worktree's name FIRST, then the base, then the harness. */
  const [naming, setNaming] = useState<{ readonly projectId: string } | null>(null);
  const [pendingName, setPendingName] = useState<string | null>(null);
  /** The fuzzy base picker between naming and the harness; null when not open. */
  const [basePicking, setBasePicking] = useState<{
    readonly projectId: string;
    readonly branches: ReadonlyArray<BranchDto>;
    readonly query: string;
    readonly index: number;
  } | null>(null);
  const [pendingBase, setPendingBase] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<{
    readonly session: SessionDto;
    readonly changeId: string;
    readonly projectName: string;
  } | null>(null);
  /** Set synchronously around attach/launch so keystrokes can't double-fire. */
  const lockRef = useRef(false);
  /** Latest modal state for mutation callbacks — closures there go stale. */
  const modalRef = useRef(false);
  modalRef.current =
    editing !== null || reviewing !== null || picker !== null || basePicking !== null;

  const { width: terminalCols, height: terminalRows } = useTerminalDimensions();
  const showProjectsPane = terminalCols >= 72;
  const showDetail = terminalRows >= 18;
  const focus: Focus = showProjectsPane ? focusState : "sessions";

  // ── pane data ──
  const projectItems = deriveProjects(data);
  const homeProject =
    data === undefined ? undefined : matchProjectByCwd(data.projects, cwdFacts(ctx.cwd));
  const projectIndexRaw =
    projectKey === null ? -1 : projectItems.findIndex((p) => p.project.id === projectKey);
  const projectIndex =
    projectIndexRaw !== -1
      ? projectIndexRaw
      : Math.max(
          0,
          homeProject === undefined
            ? 0
            : projectItems.findIndex((p) => p.project.id === homeProject.id),
        );
  const selectedProject = projectItems[projectIndex] ?? null;
  const worktreeGroups = deriveWorktrees(data, selectedProject?.project.id ?? null);
  const rows = deriveRows(worktreeGroups);
  const rowIndexRaw =
    sessionKey === null ? -1 : rows.findIndex((row) => rowKeyOf(row) === sessionKey);
  const rowIndex = rowIndexRaw === -1 ? 0 : rowIndexRaw;
  const selectedRow = rows[rowIndex] ?? null;
  const selectedGroup = selectedRow?.group ?? null;
  // A worktree header still names a concrete conversation for session verbs:
  // the newest live member, else the newest at all.
  const selectedSession =
    selectedRow === null
      ? null
      : selectedRow.kind === "session"
        ? selectedRow.item
        : (selectedRow.group.sessions.find((item) => LIVE_STATUSES.has(item.session.status)) ??
          selectedRow.group.sessions[0] ??
          null);
  const pickerItems = picker === null ? [] : deriveHarnesses(picker.session);
  const selectSession = (id: string): void => setSessionKey(`s:${id}`);

  const say = (text: string): void => setStatus({ text, at: Date.now() });
  const refetch = (): void => void queryClient.invalidateQueries({ queryKey: WORKBENCH_KEY });

  // Keep each pane's selection on screen — the one imperative escape hatch.
  const projectScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const sessionScrollRef = useRef<ScrollBoxRenderable | null>(null);
  useEffect(() => {
    keepRowVisible(projectScrollRef.current, projectIndex);
  }, [projectIndex]);
  useEffect(() => {
    // Rows vary in height (header = 1; a session row carries its process and
    // service fact lines), so the scroll target is the row's y offset.
    const rowHeight = (row: SelectableRow | undefined): number =>
      row === undefined || row.kind === "worktree"
        ? 1
        : 1 + row.item.processes.length + row.item.services.length;
    let top = 0;
    for (const [index, row] of rows.entries()) {
      if (index === rowIndex) break;
      top += rowHeight(row);
    }
    keepSpanVisible(sessionScrollRef.current, top, rowHeight(rows[rowIndex]));
  }, [rowIndex, rows]);

  const attachFlow = async (session: SessionDto): Promise<void> => {
    const short = session.id.slice(0, 8);
    lockRef.current = true;
    renderer.suspend();
    process.stdout.write(`\nattached · ${session.harness} · ${short} · detach: Ctrl+]\n\n`);
    let outcome: "detached" | "ended" | "dropped" | "interrupted" | "unavailable";
    try {
      outcome = await ctx.attachTty(session.id, session.harness);
      if (outcome === "unavailable") {
        // A live session whose terminal ended (idle: a workspace held open,
        // no PTY behind it). Enter still means "get me in" — REJOIN the shell
        // already holding the workspace when one is live; only open a fresh
        // one when nothing is attachable (stacking a new bash per attempt is
        // how a session ends up held open by orphan shells).
        const detail = await ctx.api<{ readonly processes: ReadonlyArray<SessionProcessDto> }>(
          "GET",
          `/sessions/${session.id}`,
        );
        const existing = liveShellOf(detail.processes);
        if (existing !== null) {
          process.stdout.write(`no live terminal — rejoining the open shell\n\n`);
          outcome = await ctx.attachTty(session.id, "shell", existing.id);
        } else {
          const shell = await ctx.api<{ readonly id: string }>(
            "POST",
            `/sessions/${session.id}/shell`,
          );
          process.stdout.write(`no live terminal — opened a shell in the workspace\n\n`);
          outcome = await ctx.attachTty(session.id, "shell", shell.id);
        }
      }
    } catch (error) {
      say(error instanceof Error ? error.message : String(error));
      return;
    } finally {
      renderer.resume();
      lockRef.current = false;
    }
    say(
      outcome === "unavailable"
        ? "attach unavailable — could not connect"
        : outcome === "detached" || outcome === "interrupted"
          ? `detached — ${short} keeps running`
          : outcome === "dropped"
            ? `disconnected — ${short} keeps running`
            : `session settled · ${short}`,
    );
    refetch();
  };

  /** Converge on the server's truth once, after the LAST in-flight mutation. */
  const settleRefetch = (): void => {
    if (queryClient.isMutating() === 1) refetch();
  };
  /** The current cache entry, for surgical optimistic edits. */
  const workbench = (): Workbench | undefined => queryClient.getQueryData<Workbench>(WORKBENCH_KEY);
  const patchWorkbench = (f: (data: Workbench) => Workbench): void => {
    const current = workbench();
    if (current !== undefined) queryClient.setQueryData(WORKBENCH_KEY, f(current));
  };
  /** Attaching yanks the terminal; only do it unasked when nothing else is open. */
  const attachIfIdle = async (session: SessionDto): Promise<void> => {
    if (lockRef.current || modalRef.current) {
      say(`session ready · ${session.id.slice(0, 8)} — enter attaches`);
      return;
    }
    await attachFlow(session);
  };

  // A new session appears as a `starting` row the moment enter is pressed;
  // the keyboard stays free while the workspace provisions, and the terminal
  // attaches when the launch answers — unless something else has the screen.
  const launchMutation = useMutation({
    mutationFn: async (vars: {
      readonly projectId: string;
      readonly harness: string;
      readonly name: string | null;
      readonly base: string | null;
      readonly pendingKey: string;
    }) => {
      const argv = HARNESS_COMMANDS[vars.harness];
      if (argv === undefined) throw new Error(`unknown harness "${vars.harness}"`);
      const session = await ctx.api<SessionDto>("POST", `/projects/${vars.projectId}/sessions`, {
        harness: vars.harness,
        label: null,
        name: vars.name,
        base: vars.base,
      });
      await ctx.api<SessionDto>("POST", `/sessions/${session.id}/launch`, { argv });
      return session;
    },
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: WORKBENCH_KEY });
      patchWorkbench((current) =>
        prependSession(current, vars.projectId, {
          id: vars.pendingKey,
          harness: vars.harness,
          label: null,
          branch: vars.name === null ? "provisioning…" : `mend/${vars.name}`,
          baseSha: "",
          baseRef: vars.base,
          status: "starting",
          summary: null,
          createdAt: new Date().toISOString(),
        }),
      );
      selectSession(vars.pendingKey);
      setBusy(`provisioning ${vars.harness} workspace — a first launch builds the harness image ·`);
      setBusyStarted(Date.now());
    },
    onError: (error, vars) => {
      patchWorkbench((current) => removeSession(current, vars.projectId, vars.pendingKey));
      setBusy(null);
      say(errorText(error));
    },
    onSuccess: async (session, vars) => {
      patchWorkbench((current) =>
        replaceSession(current, vars.projectId, vars.pendingKey, session),
      );
      selectSession(session.id);
      setBusy(null);
      await attachIfIdle(session);
    },
    onSettled: settleRefetch,
  });

  const resumeMutation = useMutation({
    mutationFn: (vars: {
      readonly projectId: string;
      readonly session: SessionDto;
      readonly harness: string | null;
    }) =>
      ctx.api<SessionDto>("POST", `/sessions/${vars.session.id}/resume`, {
        harness: vars.harness,
      }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: WORKBENCH_KEY });
      patchWorkbench((current) =>
        mapWorkbenchSessions(current, (session) =>
          session.id === vars.session.id ? { ...session, status: "starting" } : session,
        ),
      );
      selectSession(vars.session.id);
      setBusy(
        `resuming ${vars.session.id.slice(0, 8)} — a fresh workspace restores the saved state ·`,
      );
      setBusyStarted(Date.now());
    },
    onError: (error) => {
      setBusy(null);
      say(errorText(error));
      refetch();
    },
    onSuccess: async (resumed, vars) => {
      patchWorkbench((current) =>
        replaceSession(current, vars.projectId, vars.session.id, resumed),
      );
      selectSession(resumed.id);
      setBusy(null);
      await attachIfIdle(resumed);
    },
    onSettled: settleRefetch,
  });

  // The label lands in the row before the server answers; an error puts the
  // truth back on the next refetch.
  const renameMutation = useMutation({
    mutationFn: (vars: { readonly session: SessionDto; readonly label: string | null }) =>
      ctx.api<SessionDto>("POST", `/sessions/${vars.session.id}/label`, { label: vars.label }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: WORKBENCH_KEY });
      patchWorkbench((current) =>
        mapWorkbenchSessions(current, (session) =>
          session.id === vars.session.id ? { ...session, label: vars.label } : session,
        ),
      );
      say(
        vars.label === null
          ? `label cleared · ${vars.session.id.slice(0, 8)}`
          : `labeled · ${vars.label}`,
      );
    },
    onError: (error) => {
      say(errorText(error));
      refetch();
    },
    onSettled: settleRefetch,
  });

  // Stops are explicit — and armed: the first press names what a second press
  // will stop; moving the selection re-arms against the newly selected row.
  const stopMutation = useMutation({
    mutationFn: (session: SessionDto) =>
      ctx.api<SessionDto>("POST", `/sessions/${session.id}/stop`),
    onMutate: async (session) => {
      await queryClient.cancelQueries({ queryKey: WORKBENCH_KEY });
      // The row settles and its live process/service facts drop in one paint.
      patchWorkbench((current) => markSessionStopped(current, session.id));
      say(`stopped · ${worktreeDisplayName(session)} — the record and review remain`);
    },
    onError: (error) => {
      say(errorText(error));
      refetch();
    },
    onSettled: settleRefetch,
  });

  // A new conversation inside an existing worktree — the `s` key's flow.
  const launchInWorktreeMutation = useMutation({
    mutationFn: async (vars: {
      readonly projectId: string;
      readonly worktreeId: string;
      readonly harness: string;
      readonly pendingKey: string;
    }) => {
      const argv = HARNESS_COMMANDS[vars.harness];
      if (argv === undefined) throw new Error(`unknown harness "${vars.harness}"`);
      const session = await ctx.api<SessionDto>("POST", `/worktrees/${vars.worktreeId}/sessions`, {
        harness: vars.harness,
        label: null,
      });
      await ctx.api<SessionDto>("POST", `/sessions/${session.id}/launch`, { argv });
      return session;
    },
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: WORKBENCH_KEY });
      patchWorkbench((current) =>
        prependSession(current, vars.projectId, {
          id: vars.pendingKey,
          worktreeId: vars.worktreeId,
          harness: vars.harness,
          label: null,
          branch: "joining…",
          baseSha: "",
          baseRef: null,
          status: "starting",
          summary: null,
          createdAt: new Date().toISOString(),
        }),
      );
      selectSession(vars.pendingKey);
      setBusy(`starting ${vars.harness} in the worktree ·`);
      setBusyStarted(Date.now());
    },
    onError: (error, vars) => {
      patchWorkbench((current) => removeSession(current, vars.projectId, vars.pendingKey));
      setBusy(null);
      say(errorText(error));
    },
    onSuccess: async (session, vars) => {
      patchWorkbench((current) =>
        replaceSession(current, vars.projectId, vars.pendingKey, session),
      );
      selectSession(session.id);
      setBusy(null);
      await attachIfIdle(session);
    },
    onSettled: settleRefetch,
  });

  // The one explicit destructive act. Against a pre-worktree server the
  // session delete IS the old combined removal — same key, old semantics.
  const removeWorktreeMutation = useMutation({
    mutationFn: (group: WorktreeGroup) =>
      group.id !== null
        ? ctx.api("DELETE", `/worktrees/${group.id}`)
        : ctx.api("DELETE", `/sessions/${group.sessions[0]?.session.id ?? ""}`),
    onMutate: async (group) => {
      await queryClient.cancelQueries({ queryKey: WORKBENCH_KEY });
      const projectId = selectedProject?.project.id;
      // The group leaves the list before the server answers; an error refetches truth.
      if (projectId !== undefined) {
        patchWorkbench((current) => removeWorktreeGroup(current, projectId, group));
      }
      say(`removing worktree · ${group.name}`);
    },
    onError: (error) => {
      say(errorText(error));
      refetch();
    },
    onSuccess: (_result, group) => {
      say(`removed · ${group.name}`);
      refetch();
    },
    onSettled: settleRefetch,
  });

  /** Worktree removal is armed like stops: the first press states the facts. */
  const [removeArmed, setRemoveArmed] = useState<string | null>(null);
  const armRemove = (): void => {
    const group = selectedGroup;
    if (group === null || group.sessions.some((item) => isPendingId(item.session.id))) return;
    if (group.live > 0) {
      say(
        `${group.live} session${group.live === 1 ? "" : "s"} live — stop them first · ${group.name}`,
      );
      return;
    }
    if (removeArmed === group.key) {
      setRemoveArmed(null);
      removeWorktreeMutation.mutate(group);
      return;
    }
    setRemoveArmed(group.key);
    const facts =
      group.sessions.length === 1
        ? "its session and change go with it"
        : `${group.sessions.length} sessions and the change go with it`;
    say(`press again to remove worktree · ${group.name} — ${facts}`);
  };

  const armStop = (): void => {
    // A worktree header arms a stop of EVERY live conversation in it.
    if (selectedRow?.kind === "worktree") {
      const group = selectedRow.group;
      const live = group.sessions.filter((item) => LIVE_STATUSES.has(item.session.status));
      if (live.length === 0) {
        say("nothing to stop — the worktree is settled");
        return;
      }
      if (stopArmed === `wt:${group.key}`) {
        setStopArmed(null);
        for (const item of live) stopMutation.mutate(item.session);
        return;
      }
      setStopArmed(`wt:${group.key}`);
      say(
        `press again to stop ${live.length} live session${live.length === 1 ? "" : "s"} · ${group.name}`,
      );
      return;
    }
    const item = selectedSession;
    if (item === null || isPendingId(item.session.id)) return;
    if (!LIVE_STATUSES.has(item.session.status)) {
      say("nothing to stop — the session is settled");
      return;
    }
    if (stopArmed === item.session.id) {
      setStopArmed(null);
      stopMutation.mutate(item.session);
      return;
    }
    setStopArmed(item.session.id);
    say(`press again to stop · ${worktreeDisplayName(item.session)}`);
  };

  const startSession = (projectId: string, harness: string): void => {
    setFocus("sessions");
    launchMutation.mutate({
      projectId,
      harness,
      name: pendingName,
      base: pendingBase,
      pendingKey: pendingId(),
    });
    setPendingName(null);
    setPendingBase(null);
  };

  /** Name first, then the base, then the harness: the worktree is the identity being created. */
  const submitWorktreeName = (value: string): void => {
    setNaming(null);
    const slug = normalizeProjectName(value.trim());
    const name = value.trim() === "" ? null : slug;
    setPendingName(name);
    const projectId = selectedProject?.project.id;
    // An existing name JOINS its worktree — the base is already fixed, so the
    // picker would only offer a refusal. Straight to the harness.
    const joins =
      name !== null &&
      projectId !== undefined &&
      (workbench()?.details.get(projectId)?.worktrees ?? []).some(
        (candidate) => candidate.name === name,
      );
    if (joins || projectId === undefined) {
      setPendingBase(null);
      openPicker(null);
      return;
    }
    void openBasePicker(projectId);
  };

  const openBasePicker = async (projectId: string): Promise<void> => {
    setBusy("reading branches ·");
    setBusyStarted(Date.now());
    try {
      const branches = await ctx.api<ReadonlyArray<BranchDto>>(
        "GET",
        `/projects/${projectId}/branches`,
      );
      setBasePicking({ projectId, branches, query: "", index: 0 });
    } catch (error) {
      // The picker is a convenience; an unreadable branch list falls back to
      // the default base rather than blocking the launch.
      say(errorText(error));
      setPendingBase(null);
      openPicker(null);
    } finally {
      setBusy(null);
    }
  };

  const submitBase = (): void => {
    const current = basePicking;
    if (current === null) return;
    const chosen = filterBranches(current.branches, current.query)[current.index];
    setBasePicking(null);
    // The default branch is what a null base means server-side; sending the
    // name would pin the same commit with extra words.
    setPendingBase(chosen === undefined || chosen.isDefault ? null : chosen.name);
    openPicker(null);
  };

  const resumeSession = (projectId: string, session: SessionDto, harness: string | null): void => {
    setFocus("sessions");
    resumeMutation.mutate({ projectId, session, harness });
  };

  const submitRename = (session: SessionDto, value: string): void => {
    setEditing(null);
    const label = value.trim() === "" ? null : value.trim();
    renameMutation.mutate({ session, label });
  };

  const openPicker = (session: SessionDto | null, worktree?: WorktreeGroup): void => {
    setPicker(worktree === undefined ? { session } : { session, worktree });
    setPickerIndex(0);
  };

  const moveSelection = (delta: number): void => {
    if (picker !== null) {
      setPickerIndex((current) => Math.max(0, Math.min(pickerItems.length - 1, current + delta)));
      return;
    }
    if (focus === "projects") {
      if (projectItems.length === 0) return;
      const next = Math.max(0, Math.min(projectItems.length - 1, projectIndex + delta));
      const item = projectItems[next];
      if (item !== undefined) {
        setProjectKey(item.project.id);
        setSessionKey(null);
      }
      return;
    }
    if (rows.length === 0) return;
    const next = Math.max(0, Math.min(rows.length - 1, rowIndex + delta));
    const row = rows[next];
    if (row !== undefined) setSessionKey(rowKeyOf(row));
  };

  const activate = (): void => {
    if (picker !== null) {
      const choice = pickerItems[pickerIndex];
      const projectId = selectedProject?.project.id;
      if (choice === undefined || projectId === undefined) return;
      setPicker(null);
      if (picker.worktree !== undefined && picker.worktree.id !== null) {
        if (choice.harness !== null) {
          setFocus("sessions");
          launchInWorktreeMutation.mutate({
            projectId,
            worktreeId: picker.worktree.id,
            harness: choice.harness,
            pendingKey: pendingId(),
          });
        }
      } else if (picker.session === null) {
        if (choice.harness !== null) startSession(projectId, choice.harness);
      } else {
        resumeSession(projectId, picker.session, choice.harness);
      }
      return;
    }
    if (focus === "projects") {
      setFocus("sessions");
      return;
    }
    if (selectedRow?.kind === "worktree") {
      // Enter on the place: attach its newest live conversation, or open a
      // new one when nothing is live.
      const live = selectedRow.group.sessions.find((item) =>
        LIVE_STATUSES.has(item.session.status),
      );
      if (live !== undefined) {
        void attachFlow(live.session);
      } else if (selectedRow.group.id !== null) {
        openPicker(null, selectedRow.group);
      }
      return;
    }
    const item = selectedSession;
    if (item === null) return;
    if (isPendingId(item.session.id)) {
      say("still provisioning — the row fills in when the workspace answers");
    } else if (LIVE_STATUSES.has(item.session.status)) {
      void attachFlow(item.session);
    } else {
      openPicker(item.session);
    }
  };

  useKeyboard((key) => {
    if (reviewing !== null) return;
    if (lockRef.current) return;
    if (key.ctrl && key.name === "c") return onQuit();
    if (editing !== null) {
      // The input owns the keyboard; only escape leaves without saving.
      if (key.name === "escape") setEditing(null);
      return;
    }
    if (naming !== null) {
      if (key.name === "escape") setNaming(null);
      return;
    }
    if (basePicking !== null) {
      // The input owns the characters; the list owns the arrows. Enter lands
      // through the input's submit so typed-but-unflushed text never races.
      if (key.name === "escape") {
        setBasePicking(null);
        setPendingName(null);
        say("new worktree cancelled");
      } else if (key.name === "down" || (key.ctrl === true && key.name === "n")) {
        setBasePicking((current) => {
          if (current === null) return current;
          const matches = filterBranches(current.branches, current.query).length;
          return { ...current, index: Math.min(Math.max(0, matches - 1), current.index + 1) };
        });
      } else if (key.name === "up" || (key.ctrl === true && key.name === "p")) {
        setBasePicking((current) =>
          current === null ? current : { ...current, index: Math.max(0, current.index - 1) },
        );
      }
      return;
    }
    if (picker !== null) {
      switch (key.name) {
        case "down":
        case "j":
          return moveSelection(1);
        case "up":
        case "k":
          return moveSelection(-1);
        case "return":
        case "linefeed":
        case "l":
          return activate();
        case "escape":
        case "q":
        case "h":
          return setPicker(null);
        default:
          return;
      }
    }
    // Shift+K (and x below): stop the selected session. Lowercase k stays
    // vim-up; the shift is the deliberateness the arm-confirm then doubles.
    if (key.shift === true && key.name === "k") return armStop();
    // Shift+D: remove the selected worktree — the one explicit destructive act.
    if (key.shift === true && key.name === "d") return armRemove();
    switch (key.name) {
      case "q":
        return onQuit();
      case "down":
      case "j":
        return moveSelection(1);
      case "up":
      case "k":
        return moveSelection(-1);
      case "x":
        return armStop();
      case "return":
      case "linefeed":
        return activate();
      case "l":
      case "right":
        if (focus === "projects") setFocus("sessions");
        return;
      case "h":
      case "left":
      case "-":
      case "backspace":
        if (showProjectsPane) setFocus("projects");
        return;
      case "tab":
        if (showProjectsPane) setFocus(focus === "projects" ? "sessions" : "projects");
        return;
      case "n":
        // The worktree's name comes first; the harness picker follows.
        if (selectedProject !== null) setNaming({ projectId: selectedProject.project.id });
        return;
      case "s": {
        // A new conversation inside the selected worktree.
        const group = selectedGroup;
        if (group === null) return;
        if (group.id === null) {
          say("this server predates shared worktrees — n starts a new one");
          return;
        }
        openPicker(null, group);
        return;
      }
      case "e": {
        const item = selectedSession;
        if (item !== null && !isPendingId(item.session.id)) setEditing(item.session);
        return;
      }
      case "o": {
        const item = selectedSession;
        if (item !== null && !isPendingId(item.session.id)) {
          openUrl(`${ctx.config.url}/sessions/${item.session.id}`);
          say(`opened · ${ctx.config.url}/sessions/${item.session.id.slice(0, 8)}…`);
        }
        return;
      }
      case "v": {
        const item = selectedSession;
        if (item === null) return;
        if (isPendingId(item.session.id)) {
          say("still provisioning — nothing to review yet");
          return;
        }
        const target = reviewTargetForSession(
          item.session,
          selectedGroup?.annotation ?? item.annotation,
          selectedProject?.project.name ?? "project",
        );
        if (target === null) {
          say("this session has no reviewable change yet");
          return;
        }
        setReviewing(target);
        return;
      }
      case "r":
        say("refreshing…");
        refetch();
        return;
      default:
        return;
    }
  });

  // ── chrome ──
  const liveTotal = projectItems.reduce((sum, item) => sum + item.live, 0);
  const nameWidth = Math.min(16, Math.max(...projectItems.map((p) => p.project.name.length), 4));
  const sessionsTitle =
    selectedProject === null
      ? "sessions"
      : `sessions — ${selectedProject.project.name}${
          selectedProject.live > 0 ? ` · ${selectedProject.live} live` : ""
        }`;
  const detailTitle =
    selectedSession === null || selectedGroup === null
      ? "session"
      : `worktree — ${selectedGroup.name} · ${selectedSession.session.harness} ${selectedSession.session.id.slice(0, 8)}`;
  const pickerTitle =
    picker === null
      ? ""
      : picker.worktree !== undefined
        ? `new session in ${picker.worktree.name} — pick a harness`
        : picker.session === null
          ? "new session — pick a harness"
          : `resume ${picker.session.id.slice(0, 8)} — pick a harness`;
  const footerText =
    editing !== null
      ? " enter save · esc cancel"
      : naming !== null
        ? " enter continue — base and harness follow · esc cancel"
        : basePicking !== null
          ? " type to filter · ↑↓ move · enter choose base · esc cancel"
          : picker !== null
            ? " ↑↓ move · enter start · esc cancel"
            : focus === "projects"
              ? " ↑↓ move · enter/l sessions · ⇥ panes · r refresh · q quit"
              : " ↑↓ move · enter attach/resume · n new worktree · s session here · x stop · ⇧D remove · v review · e rename · o web · q quit";

  const loadFailure =
    data === undefined && failureReason !== null
      ? failureReason instanceof Error
        ? failureReason.message
        : String(failureReason)
      : null;

  if (reviewing !== null) {
    return (
      <ReviewScreen
        ctx={ctx}
        projectName={reviewing.projectName}
        session={reviewing.session}
        changeId={reviewing.changeId}
        onBack={() => {
          setReviewing(null);
          refetch();
        }}
        onQuit={onQuit}
      />
    );
  }

  return (
    <box flexGrow={1} flexDirection="column" backgroundColor="transparent">
      <box height={1} flexDirection="row" justifyContent="space-between">
        <text height={1} bg="transparent">
          <span fg={INK}> mend</span>
          <span fg={MUTED}>
            {"  "}
            {projectItems.length} project{projectItems.length === 1 ? "" : "s"}
          </span>
          <span fg={FAINT}> · </span>
          <span fg={liveTotal > 0 ? MUTED : FAINT}>{liveTotal} live</span>
        </text>
        <text height={1} fg={FAINT} bg="transparent">
          {`${ctx.config.url}  `}
        </text>
      </box>
      <box flexGrow={1} flexShrink={1} minHeight={0} flexDirection="row">
        {showProjectsPane ? (
          <Pane title="projects" focused={focus === "projects"} width={PROJECTS_PANE_WIDTH}>
            <scrollbox
              ref={projectScrollRef}
              flexGrow={1}
              flexShrink={1}
              minHeight={0}
              style={paneScrollStyle}
            >
              {projectItems.map((item, index) => (
                <ProjectRow
                  key={item.project.id}
                  item={item}
                  selected={index === projectIndex}
                  nameWidth={nameWidth}
                />
              ))}
              {data !== undefined && projectItems.length === 0 ? (
                <text height={1} fg={FAINT} bg="transparent">
                  {"  none adopted yet"}
                </text>
              ) : null}
            </scrollbox>
          </Pane>
        ) : null}
        <Pane title={sessionsTitle} focused={focus === "sessions"} grow>
          <scrollbox
            ref={sessionScrollRef}
            flexGrow={1}
            flexShrink={1}
            minHeight={0}
            style={paneScrollStyle}
          >
            {rows.map((row, index) =>
              row.kind === "worktree" ? (
                <WorktreeHeaderRow
                  key={rowKeyOf(row)}
                  group={row.group}
                  selected={index === rowIndex}
                />
              ) : row.group.sessions.length === 1 ? (
                <CombinedRow
                  key={rowKeyOf(row)}
                  group={row.group}
                  item={row.item}
                  selected={index === rowIndex}
                />
              ) : (
                <SessionChildRow
                  key={rowKeyOf(row)}
                  item={row.item}
                  selected={index === rowIndex}
                />
              ),
            )}
            {data !== undefined && rows.length === 0 ? (
              <text height={1} fg={FAINT} bg="transparent">
                {"  no sessions yet — n starts one"}
              </text>
            ) : null}
            {loadFailure !== null ? (
              <text height={1} fg={INK_2} bg="transparent">
                {`  ${loadFailure} — retrying`}
              </text>
            ) : null}
          </scrollbox>
        </Pane>
      </box>

      {picker !== null ? (
        <Pane title={pickerTitle} focused height={2 + pickerItems.length}>
          {pickerItems.map((item, index) => (
            <HarnessRow key={String(item.harness)} item={item} selected={index === pickerIndex} />
          ))}
        </Pane>
      ) : basePicking !== null ? (
        <Pane
          title={` base — ${pendingName ?? "new worktree"} `}
          focused
          height={
            3 +
            Math.min(8, Math.max(1, filterBranches(basePicking.branches, basePicking.query).length))
          }
        >
          <input
            focused
            value=""
            placeholder="type to filter branches (enter = highlighted, empty = default)"
            backgroundColor="transparent"
            focusedBackgroundColor="transparent"
            textColor={INK}
            focusedTextColor={INK}
            placeholderColor={FAINT}
            cursorColor={INK}
            flexShrink={0}
            onInput={(value: string) => {
              setBasePicking((current) =>
                current === null ? current : { ...current, query: value, index: 0 },
              );
            }}
            onSubmit={() => submitBase()}
          />
          {filterBranches(basePicking.branches, basePicking.query)
            .slice(0, 8)
            .map((branch, index) => (
              <box
                key={branch.name}
                height={1}
                flexShrink={0}
                backgroundColor={index === basePicking.index ? WASH : "transparent"}
              >
                <text height={1} bg="transparent">
                  <Gutter selected={index === basePicking.index} />
                  <span fg={INK}>{branch.name.slice(0, 44).padEnd(45)}</span>
                  <span fg={FAINT}>{branch.sha.slice(0, 8).padEnd(10)}</span>
                  <span fg={MUTED}>
                    {timeAgo(branch.committedAt).replace(" ago", "").padEnd(6)}
                  </span>
                  {branch.isDefault ? <span fg={FAINT}>default</span> : null}
                </text>
              </box>
            ))}
          {filterBranches(basePicking.branches, basePicking.query).length === 0 ? (
            <text height={1} fg={FAINT} bg="transparent">
              {"  no branch matches — esc cancels"}
            </text>
          ) : null}
        </Pane>
      ) : naming !== null ? (
        <box
          border
          borderStyle="rounded"
          borderColor={COBALT}
          title=" new worktree — name "
          titleAlignment="left"
          backgroundColor="transparent"
          height={3}
          flexShrink={0}
        >
          <input
            focused
            value=""
            placeholder="name the worktree, e.g. fix-auth (empty = auto)"
            backgroundColor="transparent"
            focusedBackgroundColor="transparent"
            textColor={INK}
            focusedTextColor={INK}
            placeholderColor={FAINT}
            cursorColor={INK}
            flexGrow={1}
            onSubmit={(value: unknown) => {
              if (typeof value === "string") submitWorktreeName(value);
            }}
          />
        </box>
      ) : editing !== null ? (
        <box
          border
          borderStyle="rounded"
          borderColor={COBALT}
          title={` label — ${editing.harness} ${editing.id.slice(0, 8)} `}
          titleAlignment="left"
          backgroundColor="transparent"
          height={3}
          flexShrink={0}
        >
          <input
            focused
            value={editing.label ?? ""}
            placeholder="a few words for what this session is doing (empty clears)"
            backgroundColor="transparent"
            focusedBackgroundColor="transparent"
            textColor={INK}
            focusedTextColor={INK}
            placeholderColor={FAINT}
            cursorColor={INK}
            flexGrow={1}
            onSubmit={(value: unknown) => {
              if (typeof value === "string") submitRename(editing, value);
            }}
          />
        </box>
      ) : showDetail ? (
        <Pane title={detailTitle} focused={false} height={6}>
          <SessionDetail item={selectedSession} />
        </Pane>
      ) : null}

      <StatusLine busy={busy} busyStarted={busyStarted} status={status} />
      <text height={1} fg={FAINT} bg="transparent">
        {footerText}
      </text>
    </box>
  );
};

// ─── entry ──────────────────────────────────────────────────────────────────

export const runDashboard = async (ctx: DashboardContext): Promise<void> => {
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  const queryClient = new QueryClient();
  const controller = new AbortController();
  let eventTimer: ReturnType<typeof setTimeout> | null = null;

  const quit = (): void => {
    controller.abort();
    if (eventTimer !== null) clearTimeout(eventTimer);
    // Drop cached queries so their gc/retry timers stop pinning the event loop.
    queryClient.clear();
    // The canonical opentui shutdown (its own exitOnCtrlC path does exactly
    // this): destroy on the next tick and let the process end on its own. A
    // process.exit() here would race destroy()'s deferred finalize — the
    // kitty keyboard protocol stays pushed and the shell is left eating
    // ^[[..;..:.u key-release sequences.
    process.nextTick(() => renderer.destroy());
  };

  // The SSE stream invalidates the cache from outside React. Frames are
  // parsed and each pointer event stales only its query families — the
  // 25-second heartbeat and per-record-line progress invalidate nothing, so
  // an idle dashboard makes no requests and a busy session doesn't turn push
  // into a refetch loop. The flush waits out in-flight mutations: their
  // onSettled refetch converges on the same truth without a mid-write
  // snapshot clobbering an optimistic row.
  const pendingFamilies = new Set<InvalidateFamily>();
  const flushInvalidations = (): void => {
    eventTimer = null;
    if (queryClient.isMutating() > 0) {
      eventTimer = setTimeout(flushInvalidations, 250);
      return;
    }
    const families = [...pendingFamilies];
    pendingFamilies.clear();
    for (const family of families) {
      void queryClient.invalidateQueries({ queryKey: [family] });
    }
  };
  const scheduleInvalidate = (families: ReadonlyArray<InvalidateFamily>): void => {
    if (families.length === 0) return;
    for (const family of families) pendingFamilies.add(family);
    if (eventTimer === null) eventTimer = setTimeout(flushInvalidations, 250);
  };
  const watch = async (): Promise<void> => {
    while (!controller.signal.aborted) {
      try {
        const headers: Record<string, string> = {};
        if (ctx.config.token !== null) headers["authorization"] = `Bearer ${ctx.config.token}`;
        const response = await fetch(`${ctx.config.url}/api/events`, {
          headers,
          signal: controller.signal,
        });
        if (!response.ok || response.body === null) throw new Error(String(response.status));
        const reader = response.body.getReader();
        const parser = createSseParser();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const payload of parser.push(decoder.decode(value, { stream: true }))) {
            scheduleInvalidate(eventFamilies(payload));
          }
        }
      } catch {
        if (controller.signal.aborted) return;
      }
      // A dropped stream may have swallowed events — re-read once on reconnect.
      pendingFamilies.add("workbench").add("review");
      if (eventTimer === null && !controller.signal.aborted) {
        eventTimer = setTimeout(flushInvalidations, 250);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  };
  void watch();

  createRoot(renderer).render(
    <QueryClientProvider client={queryClient}>
      <App ctx={ctx} onQuit={quit} />
    </QueryClientProvider>,
  );
  // finalizeDestroy() emits DESTROY synchronously mid-teardown; this
  // continuation is a microtask, so it runs after the terminal is fully
  // restored. Settling here lets main()'s top-level await finish and the
  // process exit 0 naturally — no process.exit, no unsettled-await code 13.
  await new Promise<void>((resolve) => {
    renderer.once(CliRenderEvents.DESTROY, () => resolve());
  });
};

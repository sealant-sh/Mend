import { CliRenderEvents, createCliRenderer, type ScrollBoxRenderable } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { reviewTargetForSession } from "./review-workflow.ts";
import { ReviewScreen } from "./review.tsx";
import { cwdFacts, HARNESS_COMMANDS, LIVE_STATUSES, matchProjectByCwd } from "./shared.ts";
import { openUrl } from "./terminal.ts";
import { AMBER, BG, COBALT, FAINT, GREEN, INK, MUTED, RED, RULE, WASH } from "./tui-theme.ts";

/**
 * The workbench dashboard (bare `mend`): oil-style navigation over the
 * machine's projects and sessions, rendered with @opentui/react. Server
 * state lives in one TanStack Query cache entry; the SSE stream (the same
 * one the web app uses) invalidates it from outside React, so there are no
 * data-fetching effects — components just read the query. It opens on the
 * cwd's project when one matches; `-`/`h` steps up to every project, enter
 * attaches or resumes, `v` reviews its change, `n` starts a session, and
 * `e` renames one.
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
  readonly api: <T>(method: "GET" | "POST", route: string, body?: unknown) => Promise<T>;
  /** The PTY bridge; resolves when the session settles or the user detaches. */
  readonly attachTty: (
    sessionId: string,
    harness: string,
    processId?: string,
  ) => Promise<"detached" | "ended" | "unavailable">;
}

interface ProjectDto {
  readonly id: string;
  readonly name: string;
  readonly originUrl: string | null;
  readonly storePath: string;
  readonly defaultBranch: string;
}

interface SessionDto {
  readonly id: string;
  readonly harness: string;
  readonly label: string | null;
  readonly branch: string;
  readonly baseSha: string;
  readonly status: string;
  readonly summary: string | null;
  readonly createdAt: string;
}

interface SessionAnnotationDto {
  readonly sessionId: string;
  readonly changeId: string | null;
  readonly openComments: number;
  readonly pendingFollowUp: boolean;
}

interface ProjectDetailDto {
  readonly project: ProjectDto;
  readonly sessions: ReadonlyArray<SessionDto>;
  readonly annotations: ReadonlyArray<SessionAnnotationDto>;
}

interface ServiceDto {
  readonly id: string;
  readonly sessionId: string;
  readonly label: string | null;
  readonly status: string;
  readonly workspacePort: number | null;
  readonly protocol: "tcp" | "udp";
  readonly hostPort: number | null;
}

const STATUS_GLYPH: Record<string, string> = {
  starting: "○",
  running: "●",
  waiting: "●",
  idle: "●",
  completed: "●",
  failed: "●",
  stopped: "○",
};

const STATUS_COLOR: Record<string, string> = {
  starting: COBALT,
  running: COBALT,
  waiting: AMBER,
  idle: COBALT,
  completed: GREEN,
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

// ─── server state: one cache entry, invalidated by the event stream ─────────

interface Workbench {
  readonly projects: ReadonlyArray<ProjectDto>;
  readonly details: ReadonlyMap<string, ProjectDetailDto>;
  /** Live Services grouped by session — what is running right now. */
  readonly servicesBySession: ReadonlyMap<string, ReadonlyArray<ServiceDto>>;
}

const WORKBENCH_KEY = ["workbench"];

const fetchWorkbench = async (ctx: DashboardContext): Promise<Workbench> => {
  const projects = await ctx.api<ReadonlyArray<ProjectDto>>("GET", "/projects");
  const [fetched, services] = await Promise.all([
    Promise.all(
      projects.map((project) => ctx.api<ProjectDetailDto>("GET", `/projects/${project.id}`)),
    ),
    ctx.api<ReadonlyArray<ServiceDto>>("GET", "/services"),
  ]);
  const servicesBySession = new Map<string, ServiceDto[]>();
  for (const service of services) {
    const bucket = servicesBySession.get(service.sessionId) ?? [];
    bucket.push(service);
    servicesBySession.set(service.sessionId, bucket);
  }
  return {
    projects,
    details: new Map(fetched.map((detail) => [detail.project.id, detail])),
    servicesBySession,
  };
};

// ─── the three views and their list items ───────────────────────────────────

type View =
  | { readonly kind: "projects" }
  | { readonly kind: "sessions"; readonly projectId: string }
  | {
      readonly kind: "picker";
      readonly projectId: string;
      /** null session = a new session; set = resume that session. */
      readonly session: SessionDto | null;
    };

interface SessionItem {
  readonly kind: "session";
  readonly session: SessionDto;
  readonly annotation: SessionAnnotationDto | undefined;
  readonly services: ReadonlyArray<ServiceDto>;
}

interface ProjectItem {
  readonly kind: "project";
  readonly project: ProjectDto;
  readonly total: number;
  readonly live: number;
  readonly open: number;
}

interface HarnessItem {
  readonly kind: "harness";
  /** null = resume with the same harness the session last ran. */
  readonly harness: string | null;
  readonly label: string;
  readonly hint: string;
}

type Item = SessionItem | ProjectItem | HarnessItem;

const itemKey = (item: Item): string =>
  item.kind === "session"
    ? item.session.id
    : item.kind === "project"
      ? item.project.id
      : String(item.harness);

const itemHeight = (view: View): number => (view.kind === "sessions" ? 2 : 1);

const homeView = (cwd: string, data: Workbench): View => {
  const home = matchProjectByCwd(data.projects, cwdFacts(cwd));
  return home === undefined ? { kind: "projects" } : { kind: "sessions", projectId: home.id };
};

const deriveItems = (view: View, data: Workbench | undefined): ReadonlyArray<Item> => {
  if (data === undefined) return [];
  if (view.kind === "projects") {
    return data.projects.map((project): ProjectItem => {
      const detail = data.details.get(project.id);
      const sessions = detail?.sessions ?? [];
      const live = sessions.filter((s) => LIVE_STATUSES.has(s.status)).length;
      const open = (detail?.annotations ?? []).reduce((sum, a) => sum + a.openComments, 0);
      return { kind: "project", project, total: sessions.length, live, open };
    });
  }
  if (view.kind === "sessions") {
    const detail = data.details.get(view.projectId);
    if (detail === undefined) return [];
    return detail.sessions
      .toSorted((a, b) => {
        const aLive = LIVE_STATUSES.has(a.status) ? 1 : 0;
        const bLive = LIVE_STATUSES.has(b.status) ? 1 : 0;
        if (aLive !== bLive) return bLive - aLive;
        return b.createdAt.localeCompare(a.createdAt);
      })
      .map(
        (session): SessionItem => ({
          kind: "session",
          session,
          annotation: detail.annotations.find((a) => a.sessionId === session.id),
          services: data.servicesBySession.get(session.id) ?? [],
        }),
      );
  }
  const resuming = view.session;
  if (resuming !== null) {
    const others = Object.keys(HARNESS_COMMANDS).filter((h) => h !== resuming.harness);
    return [
      {
        kind: "harness",
        harness: null,
        label: resuming.harness,
        hint: "same harness — native resume, conversation intact",
      },
      ...others.map(
        (harness): HarnessItem => ({
          kind: "harness",
          harness,
          label: harness,
          hint:
            harness === "shell"
              ? "a bash in the worktree — resume either agent from inside"
              : "the conversation crosses as a distilled prompt",
        }),
      ),
    ];
  }
  return Object.keys(HARNESS_COMMANDS).map(
    (harness): HarnessItem => ({
      kind: "harness",
      harness,
      label: harness,
      hint:
        harness === "shell"
          ? "a plain bash session — new worktree, recorded"
          : `mend ${harness} — new worktree, recorded session`,
    }),
  );
};

// ─── rows: JSX spans instead of StyledText chunks ───────────────────────────

const Gutter = ({ selected }: { readonly selected: boolean }) => (
  <span fg={selected ? COBALT : FAINT}>{selected ? "▌ " : "  "}</span>
);

/** Facts joined with dim separators — label, review state, age. */
const Facts = ({ facts }: { readonly facts: ReadonlyArray<ReactNode> }) => {
  if (facts.length === 0) return <span fg={FAINT}>—</span>;
  return (
    <>
      {facts.map((fact, index) => (
        // eslint-disable-next-line react/no-array-index-key -- order is the identity here
        <span key={index}>
          {index > 0 ? <span fg={FAINT}> · </span> : null}
          {fact}
        </span>
      ))}
    </>
  );
};

const SessionRow = ({
  item,
  selected,
}: {
  readonly item: SessionItem;
  readonly selected: boolean;
}) => {
  const { session, annotation, services } = item;
  const color = STATUS_COLOR[session.status] ?? MUTED;
  const glyph = STATUS_GLYPH[session.status] ?? "·";
  const facts: Array<ReactNode> = [];
  const age = timeAgo(session.createdAt);
  if (age !== "") facts.push(<span fg={FAINT}>{age}</span>);
  // What runs right now: name :port → host port, observed state colored.
  for (const service of services.slice(0, 2)) {
    facts.push(
      <span fg={service.status === "reachable" ? GREEN : AMBER}>
        {`${service.label ?? service.id.slice(0, 6)} :${service.workspacePort ?? "?"}${service.protocol === "udp" ? "u" : ""}→${service.hostPort ?? "?"} ${service.status}`}
      </span>,
    );
  }
  if (services.length > 2) {
    facts.push(<span fg={FAINT}>{`+${services.length - 2} services`}</span>);
  }
  if (session.label !== null) facts.push(<span fg={MUTED}>{session.label}</span>);
  if (annotation !== undefined && annotation.openComments > 0) {
    facts.push(
      <span fg={AMBER}>
        {annotation.openComments} open comment{annotation.openComments === 1 ? "" : "s"}
      </span>,
    );
  }
  if (annotation !== undefined && annotation.pendingFollowUp) {
    facts.push(<span fg={AMBER}>follow-up pending</span>);
  }
  if (session.summary !== null && facts.length < 3) {
    facts.push(<span fg={FAINT}>{session.summary.split("\n")[0]?.slice(0, 60) ?? ""}</span>);
  }
  return (
    <box
      height={2}
      flexDirection="column"
      flexShrink={0}
      backgroundColor={selected ? WASH : "transparent"}
    >
      <text height={1} bg="transparent">
        <Gutter selected={selected} />
        <span fg={color}>{glyph} </span>
        <span fg={INK}>{session.harness.padEnd(9)}</span>
        <span fg={FAINT}>{session.id.slice(0, 8)}</span>
        <span fg={color}>{`  ${session.status.padEnd(10)}`}</span>
        <span fg={MUTED}>{session.branch}</span>
      </text>
      <text height={1} bg="transparent">
        <Gutter selected={selected} />
        <span>{"  "}</span>
        <Facts facts={facts} />
      </text>
    </box>
  );
};

const ProjectRow = ({
  item,
  selected,
  nameWidth,
  branchWidth,
}: {
  readonly item: ProjectItem;
  readonly selected: boolean;
  readonly nameWidth: number;
  readonly branchWidth: number;
}) => {
  const { project, total, live, open } = item;
  const counts = total === 0 ? "no sessions" : `${total} session${total === 1 ? "" : "s"}`;
  const liveText = live > 0 ? ` · ${live} live` : "";
  const openText = open > 0 ? ` · ${open} open` : "";
  const pad = " ".repeat(Math.max(1, 24 - counts.length - liveText.length - openText.length));
  return (
    <box height={1} flexShrink={0} backgroundColor={selected ? WASH : "transparent"}>
      <text height={1} bg="transparent">
        <Gutter selected={selected} />
        <span fg={INK}>{project.name.padEnd(nameWidth)}</span>
        <span>{"  "}</span>
        <span fg={MUTED}>{project.defaultBranch.padEnd(branchWidth)}</span>
        <span>{"  "}</span>
        <span fg={total === 0 ? FAINT : MUTED}>{counts}</span>
        {liveText === "" ? null : <span fg={COBALT}>{liveText}</span>}
        {openText === "" ? null : <span fg={AMBER}>{openText}</span>}
        <span fg={FAINT}>
          {pad}
          {project.storePath}
        </span>
      </text>
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
    <text height={1} fg={AMBER} bg="transparent">
      {text}
    </text>
  );
};

// ─── the app ────────────────────────────────────────────────────────────────

const CHROME_ROWS = 7; // margin + header + margin + 2 borders + status + footer

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

  const [navigated, setNavigated] = useState<View | null>(null);
  const view: View =
    navigated ?? (data === undefined ? { kind: "projects" } : homeView(ctx.cwd, data));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [busyStarted, setBusyStarted] = useState(0);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [editing, setEditing] = useState<SessionDto | null>(null);
  const [reviewing, setReviewing] = useState<{
    readonly session: SessionDto;
    readonly changeId: string;
    readonly projectName: string;
  } | null>(null);
  /** Set synchronously around attach/launch so keystrokes can't double-fire. */
  const lockRef = useRef(false);

  const items = deriveItems(view, data);
  const foundIndex = selectedKey === null ? -1 : items.findIndex((i) => itemKey(i) === selectedKey);
  const selectedIndex = foundIndex === -1 ? 0 : foundIndex;

  const say = (text: string): void => setStatus({ text, at: Date.now() });
  const refetch = (): void => void queryClient.invalidateQueries({ queryKey: WORKBENCH_KEY });
  const setView = (next: View): void => {
    setNavigated(next);
    setSelectedKey(null);
  };

  // Keep the selection on screen — the one imperative escape hatch.
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const { height: terminalRows } = useTerminalDimensions();
  const rowH = itemHeight(view);
  useEffect(() => {
    const scroll = scrollRef.current;
    if (scroll === null) return;
    const top = selectedIndex * rowH;
    const viewH = Math.max(1, terminalRows - CHROME_ROWS - (editing === null ? 0 : 3));
    if (top < scroll.scrollTop) scroll.scrollTo(top);
    else if (top + rowH > scroll.scrollTop + viewH) scroll.scrollTo(top + rowH - viewH);
  }, [selectedIndex, rowH, terminalRows, editing]);

  const beginBusy = (label: string): void => {
    lockRef.current = true;
    setBusy(label);
    setBusyStarted(Date.now());
  };
  const endBusy = (): void => {
    lockRef.current = false;
    setBusy(null);
  };

  const attachFlow = async (session: SessionDto): Promise<void> => {
    const short = session.id.slice(0, 8);
    lockRef.current = true;
    renderer.suspend();
    process.stdout.write(`\nattached · ${session.harness} · ${short} · detach: Ctrl+]\n\n`);
    let outcome: "detached" | "ended" | "unavailable";
    try {
      outcome = await ctx.attachTty(session.id, session.harness);
      if (outcome === "unavailable") {
        // A live session whose terminal ended (idle: a workspace held open,
        // no PTY behind it). Enter still means "get me in" — open a fresh
        // shell in the same workspace and attach to that.
        const shell = await ctx.api<{ readonly id: string }>(
          "POST",
          `/sessions/${session.id}/shell`,
        );
        process.stdout.write(`no live terminal — opened a shell in the workspace\n\n`);
        outcome = await ctx.attachTty(session.id, "shell", shell.id);
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
        : outcome === "detached"
          ? `detached — ${short} keeps running`
          : `session settled · ${short}`,
    );
    refetch();
  };

  const startSession = async (projectId: string, harness: string): Promise<void> => {
    const argv = HARNESS_COMMANDS[harness];
    if (argv === undefined) return;
    setView({ kind: "sessions", projectId });
    beginBusy(`provisioning ${harness} workspace — a first launch builds the harness image ·`);
    try {
      const session = await ctx.api<SessionDto>("POST", `/projects/${projectId}/sessions`, {
        harness,
        label: null,
        base: null,
      });
      await ctx.api<SessionDto>("POST", `/sessions/${session.id}/launch`, { argv });
      endBusy();
      await attachFlow(session);
    } catch (error) {
      endBusy();
      say(error instanceof Error ? error.message : String(error));
    }
    refetch();
  };

  const resumeSession = async (
    projectId: string,
    session: SessionDto,
    harness: string | null,
  ): Promise<void> => {
    setView({ kind: "sessions", projectId });
    setSelectedKey(session.id);
    beginBusy(`resuming ${session.id.slice(0, 8)} — a fresh workspace restores the saved state ·`);
    try {
      const resumed = await ctx.api<SessionDto>("POST", `/sessions/${session.id}/resume`, {
        harness,
      });
      endBusy();
      await attachFlow(resumed);
    } catch (error) {
      endBusy();
      say(error instanceof Error ? error.message : String(error));
    }
    refetch();
  };

  const submitRename = async (session: SessionDto, value: string): Promise<void> => {
    setEditing(null);
    const label = value.trim() === "" ? null : value.trim();
    try {
      await ctx.api<SessionDto>("POST", `/sessions/${session.id}/label`, { label });
      say(label === null ? `label cleared · ${session.id.slice(0, 8)}` : `labeled · ${label}`);
    } catch (error) {
      say(error instanceof Error ? error.message : String(error));
    }
    refetch();
  };

  const moveSelection = (delta: number): void => {
    if (items.length === 0) return;
    const next = Math.max(0, Math.min(items.length - 1, selectedIndex + delta));
    const item = items[next];
    if (item !== undefined) setSelectedKey(itemKey(item));
  };

  const activate = (): void => {
    const item = items[selectedIndex];
    if (item === undefined) return;
    if (item.kind === "project") {
      setView({ kind: "sessions", projectId: item.project.id });
      return;
    }
    if (item.kind === "session" && view.kind === "sessions") {
      if (LIVE_STATUSES.has(item.session.status)) {
        void attachFlow(item.session);
      } else {
        setView({ kind: "picker", projectId: view.projectId, session: item.session });
      }
      return;
    }
    if (item.kind === "harness" && view.kind === "picker") {
      const { projectId, session } = view;
      if (session === null) {
        if (item.harness !== null) void startSession(projectId, item.harness);
      } else {
        void resumeSession(projectId, session, item.harness);
      }
    }
  };

  /** `-`, backspace, or vim `h`: one level up. */
  const goUp = (): void => {
    if (view.kind === "sessions") setView({ kind: "projects" });
    if (view.kind === "picker") setView({ kind: "sessions", projectId: view.projectId });
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
    switch (key.name) {
      case "q":
        return onQuit();
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
      case "-":
      case "backspace":
      case "h":
        return goUp();
      case "escape":
        if (view.kind === "picker") setView({ kind: "sessions", projectId: view.projectId });
        return;
      case "n":
        if (view.kind === "sessions") {
          setView({ kind: "picker", projectId: view.projectId, session: null });
        }
        return;
      case "e": {
        const item = items[selectedIndex];
        if (view.kind === "sessions" && item !== undefined && item.kind === "session") {
          setEditing(item.session);
        }
        return;
      }
      case "o": {
        const item = items[selectedIndex];
        if (item !== undefined && item.kind === "session") {
          openUrl(`${ctx.config.url}/sessions/${item.session.id}`);
          say(`opened · ${ctx.config.url}/sessions/${item.session.id.slice(0, 8)}…`);
        }
        return;
      }
      case "v": {
        const item = items[selectedIndex];
        if (view.kind !== "sessions" || item === undefined || item.kind !== "session") return;
        const target = reviewTargetForSession(
          item.session,
          item.annotation,
          detail?.project.name ?? "project",
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

  // ── chrome derived from the view ──
  const projects = data?.projects ?? [];
  const liveTotal =
    data === undefined
      ? 0
      : [...data.details.values()]
          .flatMap((d) => d.sessions)
          .filter((s) => LIVE_STATUSES.has(s.status)).length;
  const detail = view.kind === "projects" ? undefined : data?.details.get(view.projectId);
  const nameWidth = Math.max(...projects.map((p) => p.name.length), 4);
  const branchWidth = Math.max(...projects.map((p) => p.defaultBranch.length), 4);

  let title: string;
  let headerContext: ReactNode;
  let footerText: string;
  if (view.kind === "projects") {
    title = " projects ";
    headerContext = (
      <>
        <span fg={MUTED}>
          {projects.length} project{projects.length === 1 ? "" : "s"}
        </span>
        <span fg={FAINT}> · </span>
        <span fg={liveTotal > 0 ? COBALT : FAINT}>{liveTotal} live</span>
      </>
    );
    footerText = " ↑↓/jk move · enter/l open project · r refresh · q quit";
  } else if (view.kind === "sessions") {
    const name = detail?.project.name ?? "?";
    const live = (detail?.sessions ?? []).filter((s) => LIVE_STATUSES.has(s.status)).length;
    title = ` sessions — ${name} `;
    headerContext = (
      <>
        <span fg={COBALT}>{name}</span>
        <span fg={FAINT}> {detail?.project.defaultBranch ?? ""}</span>
        <span fg={FAINT}> · </span>
        <span fg={live > 0 ? COBALT : FAINT}>{live} live</span>
      </>
    );
    footerText =
      " ↑↓/jk move · enter/l attach/resume · v review in TUI · o web · n new · e rename · h/- projects · q quit";
  } else {
    const forSession = view.session;
    title =
      forSession === null
        ? " new session — pick a harness "
        : ` resume ${forSession.id.slice(0, 8)} — pick a harness `;
    headerContext = (
      <span fg={MUTED}>
        {forSession === null
          ? "a fresh worktree, recorded from the first keystroke"
          : "same worktree, restored state"}
      </span>
    );
    footerText = " ↑↓ move · enter start · esc/h back";
  }

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
    <box flexGrow={1} flexDirection="column" backgroundColor={BG}>
      <box
        height={1}
        marginTop={1}
        flexDirection="row"
        justifyContent="space-between"
        backgroundColor="transparent"
      >
        <text height={1} bg="transparent">
          <span fg={INK}> mend</span>
          <span>{"  "}</span>
          {headerContext}
        </text>
        <text height={1} fg={FAINT} bg="transparent">
          {`${ctx.config.url}  `}
        </text>
      </box>

      <box
        border
        borderStyle="rounded"
        borderColor={RULE}
        title={title}
        titleAlignment="left"
        backgroundColor={BG}
        flexGrow={1}
        flexShrink={1}
        minHeight={0}
        marginTop={1}
      >
        <scrollbox
          ref={scrollRef}
          flexGrow={1}
          flexShrink={1}
          minHeight={0}
          style={{
            rootOptions: { backgroundColor: BG, border: false },
            wrapperOptions: { backgroundColor: BG },
            viewportOptions: { backgroundColor: BG },
            contentOptions: { backgroundColor: BG },
          }}
        >
          {items.map((item, index) =>
            item.kind === "session" ? (
              <SessionRow key={itemKey(item)} item={item} selected={index === selectedIndex} />
            ) : item.kind === "project" ? (
              <ProjectRow
                key={itemKey(item)}
                item={item}
                selected={index === selectedIndex}
                nameWidth={nameWidth}
                branchWidth={branchWidth}
              />
            ) : (
              <HarnessRow key={itemKey(item)} item={item} selected={index === selectedIndex} />
            ),
          )}
          {view.kind === "sessions" && data !== undefined && items.length === 0 ? (
            <text height={1} fg={FAINT} bg="transparent">
              {"  no sessions yet — n starts one"}
            </text>
          ) : null}
          {loadFailure !== null ? (
            <text height={1} fg={AMBER} bg="transparent">
              {`  ${loadFailure} — retrying`}
            </text>
          ) : null}
        </scrollbox>
      </box>

      {editing === null ? null : (
        <box
          border
          borderStyle="rounded"
          borderColor={COBALT}
          title={` label — ${editing.harness} ${editing.id.slice(0, 8)} `}
          titleAlignment="left"
          backgroundColor={BG}
          height={3}
          flexShrink={0}
        >
          <input
            focused
            value={editing.label ?? ""}
            placeholder="a few words for what this session is doing (empty clears)"
            backgroundColor={BG}
            focusedBackgroundColor={BG}
            textColor={INK}
            focusedTextColor={INK}
            placeholderColor={FAINT}
            cursorColor={INK}
            flexGrow={1}
            onSubmit={(value: unknown) => {
              if (typeof value === "string") void submitRename(editing, value);
            }}
          />
        </box>
      )}

      <StatusLine busy={busy} busyStarted={busyStarted} status={status} />
      <text height={1} fg={FAINT} bg="transparent">
        {editing === null ? footerText : " enter save · esc cancel"}
      </text>
    </box>
  );
};

// ─── entry ──────────────────────────────────────────────────────────────────

export const runDashboard = async (ctx: DashboardContext): Promise<void> => {
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  renderer.setBackgroundColor(BG);
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

  // The SSE stream invalidates the cache from outside React — any traffic
  // (heartbeats included) means state may have moved, so re-read it.
  const scheduleInvalidate = (): void => {
    if (eventTimer !== null) clearTimeout(eventTimer);
    eventTimer = setTimeout(() => {
      void queryClient.invalidateQueries();
    }, 250);
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
        for (;;) {
          const { done } = await reader.read();
          if (done) break;
          scheduleInvalidate();
        }
      } catch {
        if (controller.signal.aborted) return;
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

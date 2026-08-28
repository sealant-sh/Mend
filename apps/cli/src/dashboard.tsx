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

import { reviewTargetForSession } from "./review-workflow.ts";
import { ReviewScreen } from "./review.tsx";
import {
  cwdFacts,
  HARNESS_COMMANDS,
  isPendingId,
  LIVE_STATUSES,
  matchProjectByCwd,
  pendingId,
} from "./shared.ts";
import { openUrl } from "./terminal.ts";
import { COBALT, FAINT, INK, INK_2, MUTED, RED, RULE, WASH } from "./tui-theme.ts";
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

// ─── optimistic cache surgery: pure Workbench → Workbench ───────────────────

/** Apply `f` to every session row in every project detail. */
const mapWorkbenchSessions = (
  data: Workbench,
  f: (session: SessionDto) => SessionDto,
): Workbench => ({
  ...data,
  details: new Map(
    [...data.details].map(([id, detail]) => [id, { ...detail, sessions: detail.sessions.map(f) }]),
  ),
});

const mapProjectSessions = (
  data: Workbench,
  projectId: string,
  f: (sessions: ReadonlyArray<SessionDto>) => ReadonlyArray<SessionDto>,
): Workbench => {
  const detail = data.details.get(projectId);
  if (detail === undefined) return data;
  const details = new Map(data.details);
  details.set(projectId, { ...detail, sessions: f(detail.sessions) });
  return { ...data, details };
};

const prependSession = (data: Workbench, projectId: string, session: SessionDto): Workbench =>
  mapProjectSessions(data, projectId, (sessions) => [session, ...sessions]);

const replaceSession = (
  data: Workbench,
  projectId: string,
  oldId: string,
  session: SessionDto,
): Workbench =>
  mapProjectSessions(data, projectId, (sessions) =>
    sessions.map((candidate) => (candidate.id === oldId ? session : candidate)),
  );

const removeSession = (data: Workbench, projectId: string, sessionId: string): Workbench =>
  mapProjectSessions(data, projectId, (sessions) =>
    sessions.filter((candidate) => candidate.id !== sessionId),
  );

// ─── pane derivations ───────────────────────────────────────────────────────

interface ProjectItem {
  readonly project: ProjectDto;
  readonly total: number;
  readonly live: number;
  readonly open: number;
}

interface SessionItem {
  readonly session: SessionDto;
  readonly annotation: SessionAnnotationDto | undefined;
  readonly services: ReadonlyArray<ServiceDto>;
}

interface HarnessItem {
  /** null = resume with the same harness the session last ran. */
  readonly harness: string | null;
  readonly label: string;
  readonly hint: string;
}

const deriveProjects = (data: Workbench | undefined): ReadonlyArray<ProjectItem> =>
  (data?.projects ?? []).map((project): ProjectItem => {
    const detail = data?.details.get(project.id);
    const sessions = detail?.sessions ?? [];
    const live = sessions.filter((s) => LIVE_STATUSES.has(s.status)).length;
    const open = (detail?.annotations ?? []).reduce((sum, a) => sum + a.openComments, 0);
    return { project, total: sessions.length, live, open };
  });

const deriveSessions = (
  data: Workbench | undefined,
  projectId: string | null,
): ReadonlyArray<SessionItem> => {
  if (data === undefined || projectId === null) return [];
  const detail = data.details.get(projectId);
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
        session,
        annotation: detail.annotations.find((a) => a.sessionId === session.id),
        services: data.servicesBySession.get(session.id) ?? [],
      }),
    );
};

/** The picker's rows: resume offers the same harness first, then the crossings. */
const deriveHarnesses = (resuming: SessionDto | null): ReadonlyArray<HarnessItem> => {
  if (resuming !== null) {
    const others = Object.keys(HARNESS_COMMANDS).filter((h) => h !== resuming.harness);
    return [
      {
        harness: null,
        label: resuming.harness,
        hint: "same harness — native resume, conversation intact",
      },
      ...others.map(
        (harness): HarnessItem => ({
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
      harness,
      label: harness,
      hint:
        harness === "shell"
          ? "a plain bash session — new worktree, recorded"
          : `mend ${harness} — new worktree, recorded session`,
    }),
  );
};

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

const SessionRow = ({
  item,
  selected,
}: {
  readonly item: SessionItem;
  readonly selected: boolean;
}) => {
  const { session, annotation } = item;
  const color = STATUS_COLOR[session.status] ?? MUTED;
  const age = timeAgo(session.createdAt).replace(" ago", "");
  return (
    <box height={1} flexShrink={0} backgroundColor={selected ? WASH : "transparent"}>
      <text height={1} bg="transparent">
        <Gutter selected={selected} />
        <span fg={INK}>{session.harness.padEnd(9)}</span>
        <span fg={FAINT}>{session.id.slice(0, 8)}</span>
        <span fg={color}>{`  ${session.status.padEnd(10)}`}</span>
        <span fg={FAINT}>{age.padEnd(9)}</span>
        {annotation !== undefined && annotation.openComments > 0 ? (
          <span fg={MUTED}>{`${annotation.openComments} open  `}</span>
        ) : null}
        <span fg={MUTED}>{(session.label ?? "").slice(0, 40)}</span>
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
          {session.baseSha === "" ? "" : ` vs ${session.baseSha.slice(0, 12)}`} · started{" "}
          {timeAgo(session.createdAt)}
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
const keepRowVisible = (scroll: ScrollBoxRenderable | null, index: number): void => {
  if (scroll === null) return;
  const viewH = Math.max(1, scroll.viewport.height);
  if (index < scroll.scrollTop) scroll.scrollTo(index);
  else if (index + 1 > scroll.scrollTop + viewH) scroll.scrollTo(index + 1 - viewH);
};

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
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ readonly session: SessionDto | null } | null>(null);
  const [pickerIndex, setPickerIndex] = useState(0);
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
  /** Latest modal state for mutation callbacks — closures there go stale. */
  const modalRef = useRef(false);
  modalRef.current = editing !== null || reviewing !== null || picker !== null;

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
  const sessionItems = deriveSessions(data, selectedProject?.project.id ?? null);
  const sessionIndexRaw =
    sessionKey === null ? -1 : sessionItems.findIndex((s) => s.session.id === sessionKey);
  const sessionIndex = sessionIndexRaw === -1 ? 0 : sessionIndexRaw;
  const selectedSession = sessionItems[sessionIndex] ?? null;
  const pickerItems = picker === null ? [] : deriveHarnesses(picker.session);

  const say = (text: string): void => setStatus({ text, at: Date.now() });
  const refetch = (): void => void queryClient.invalidateQueries({ queryKey: WORKBENCH_KEY });

  // Keep each pane's selection on screen — the one imperative escape hatch.
  const projectScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const sessionScrollRef = useRef<ScrollBoxRenderable | null>(null);
  useEffect(() => {
    keepRowVisible(projectScrollRef.current, projectIndex);
  }, [projectIndex]);
  useEffect(() => {
    keepRowVisible(sessionScrollRef.current, sessionIndex);
  }, [sessionIndex]);

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
      readonly pendingKey: string;
    }) => {
      const argv = HARNESS_COMMANDS[vars.harness];
      if (argv === undefined) throw new Error(`unknown harness "${vars.harness}"`);
      const session = await ctx.api<SessionDto>("POST", `/projects/${vars.projectId}/sessions`, {
        harness: vars.harness,
        label: null,
        base: null,
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
          branch: "provisioning…",
          baseSha: "",
          status: "starting",
          summary: null,
          createdAt: new Date().toISOString(),
        }),
      );
      setSessionKey(vars.pendingKey);
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
      setSessionKey(session.id);
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
      setSessionKey(vars.session.id);
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
      setSessionKey(resumed.id);
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

  const startSession = (projectId: string, harness: string): void => {
    setFocus("sessions");
    launchMutation.mutate({ projectId, harness, pendingKey: pendingId() });
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

  const openPicker = (session: SessionDto | null): void => {
    setPicker({ session });
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
    if (sessionItems.length === 0) return;
    const next = Math.max(0, Math.min(sessionItems.length - 1, sessionIndex + delta));
    const item = sessionItems[next];
    if (item !== undefined) setSessionKey(item.session.id);
  };

  const activate = (): void => {
    if (picker !== null) {
      const choice = pickerItems[pickerIndex];
      const projectId = selectedProject?.project.id;
      if (choice === undefined || projectId === undefined) return;
      setPicker(null);
      if (picker.session === null) {
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
        if (selectedProject !== null) openPicker(null);
        return;
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
          item.annotation,
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
    selectedSession === null
      ? "session"
      : `session — ${selectedSession.session.harness} ${selectedSession.session.id.slice(0, 8)}`;
  const pickerTitle =
    picker === null
      ? ""
      : picker.session === null
        ? "new session — pick a harness"
        : `resume ${picker.session.id.slice(0, 8)} — pick a harness`;
  const footerText =
    editing !== null
      ? " enter save · esc cancel"
      : picker !== null
        ? " ↑↓ move · enter start · esc cancel"
        : focus === "projects"
          ? " ↑↓ move · enter/l sessions · ⇥ panes · r refresh · q quit"
          : " ↑↓ move · enter attach/resume · n new · v review · e rename · o web · h/⇥ projects · q quit";

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
      <box flexGrow={1} flexShrink={1} minHeight={0} flexDirection="row">
        {showProjectsPane ? (
          <Pane
            title={liveTotal > 0 ? `projects · ${liveTotal} live` : "projects"}
            focused={focus === "projects"}
            width={PROJECTS_PANE_WIDTH}
          >
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
            {sessionItems.map((item, index) => (
              <SessionRow key={item.session.id} item={item} selected={index === sessionIndex} />
            ))}
            {data !== undefined && sessionItems.length === 0 ? (
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
      <box height={1} flexDirection="row" justifyContent="space-between">
        <text height={1} fg={FAINT} bg="transparent">
          {footerText}
        </text>
        <text height={1} fg={FAINT} bg="transparent">
          {`${ctx.config.url}  `}
        </text>
      </box>
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

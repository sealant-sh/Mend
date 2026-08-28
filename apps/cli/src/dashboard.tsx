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
import { AMBER, BOLD, COBALT, DIM, editorInk, GRAY, GREEN, RED } from "./tui-theme.ts";
import { createSseParser, eventFamilies, type InvalidateFamily } from "./workbench-events.ts";

/**
 * The workbench dashboard (bare `mend`): oil-style navigation over the
 * machine's projects and sessions, rendered with @opentui/react. Server
 * state lives in one TanStack Query cache entry; the SSE stream (the same
 * one the web app uses) is parsed outside React and each pointer event
 * invalidates only the query families it can stale — heartbeats and
 * per-record-line progress invalidate nothing. Writes are optimistic
 * mutations: a rename, a new session, a resume all land in the cache
 * immediately and the server's answer reconciles on settle, so the keyboard
 * never waits on a round trip. It opens on the cwd's project when one
 * matches; `-`/`h` steps up to every project, enter attaches or resumes,
 * `v` reviews its change, `n` starts a session, and `e` renames one.
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

/**
 * Status is a colored word, nothing more: live states cobalt, waiting amber,
 * observed outcomes green/red. Settled states carry no color — they render in
 * the terminal's own dim.
 */
const STATUS_COLOR: Record<string, string> = {
  starting: COBALT,
  running: COBALT,
  waiting: AMBER,
  idle: COBALT,
  completed: GREEN,
  failed: RED,
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

/** Selection is one quiet pointer; nothing else marks the row. */
const Pointer = ({ selected }: { readonly selected: boolean }) => (
  <span fg={COBALT}>{selected ? "> " : "  "}</span>
);

/** Facts separated by plain space — the terminal's dim carries the hierarchy. */
const Facts = ({ facts }: { readonly facts: ReadonlyArray<ReactNode> }) => {
  if (facts.length === 0) return <span attributes={DIM}>—</span>;
  return (
    <>
      {facts.map((fact, index) => (
        // eslint-disable-next-line react/no-array-index-key -- order is the identity here
        <span key={index}>
          {index > 0 ? <span>{"  "}</span> : null}
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
  const color = STATUS_COLOR[session.status];
  const facts: Array<ReactNode> = [];
  const age = timeAgo(session.createdAt);
  if (age !== "") facts.push(<span attributes={DIM}>{age}</span>);
  // What runs right now: name :port → host port, observed state colored.
  for (const service of services.slice(0, 2)) {
    facts.push(
      <span fg={service.status === "reachable" ? GREEN : AMBER}>
        {`${service.label ?? service.id.slice(0, 6)} :${service.workspacePort ?? "?"}${service.protocol === "udp" ? "u" : ""}→${service.hostPort ?? "?"} ${service.status}`}
      </span>,
    );
  }
  if (services.length > 2) {
    facts.push(<span attributes={DIM}>{`+${services.length - 2} services`}</span>);
  }
  if (session.label !== null) facts.push(<span>{session.label}</span>);
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
    facts.push(<span attributes={DIM}>{session.summary.split("\n")[0]?.slice(0, 60) ?? ""}</span>);
  }
  return (
    <box height={2} flexDirection="column" flexShrink={0}>
      <text height={1}>
        <Pointer selected={selected} />
        <span {...(selected ? { fg: COBALT } : {})} attributes={BOLD}>
          {session.harness.padEnd(9)}
        </span>
        <span attributes={DIM}>{session.id.slice(0, 8)}</span>
        {color === undefined ? (
          <span attributes={DIM}>{`  ${session.status.padEnd(10)}`}</span>
        ) : (
          <span fg={color}>{`  ${session.status.padEnd(10)}`}</span>
        )}
        <span attributes={DIM}>{session.branch}</span>
      </text>
      <text height={1}>
        <span>{"    "}</span>
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
  const liveText = live > 0 ? `  ${live} live` : "";
  const openText = open > 0 ? `  ${open} open` : "";
  return (
    <box height={1} flexShrink={0}>
      <text height={1}>
        <Pointer selected={selected} />
        <span {...(selected ? { fg: COBALT } : {})} attributes={BOLD}>
          {project.name.padEnd(nameWidth)}
        </span>
        <span>{"  "}</span>
        <span attributes={DIM}>{project.defaultBranch.padEnd(branchWidth)}</span>
        <span>{"  "}</span>
        <span attributes={DIM}>{counts}</span>
        {liveText === "" ? null : <span fg={COBALT}>{liveText}</span>}
        {openText === "" ? null : <span fg={AMBER}>{openText}</span>}
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
  <box height={1} flexShrink={0}>
    <text height={1}>
      <Pointer selected={selected} />
      <span {...(selected ? { fg: COBALT } : {})}>{item.label.padEnd(12)}</span>
      <span attributes={DIM}>{item.hint}</span>
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
    <text height={1} fg={AMBER}>
      {text}
    </text>
  );
};

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// ─── the app ────────────────────────────────────────────────────────────────

const CHROME_ROWS = 5; // margin + header + margin + status + footer

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
  /** Latest modal state for mutation callbacks — closures there go stale. */
  const modalRef = useRef(false);
  modalRef.current = editing !== null || reviewing !== null;

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
      setSelectedKey(vars.pendingKey);
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
      setSelectedKey(session.id);
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
      setSelectedKey(vars.session.id);
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
      setSelectedKey(resumed.id);
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
    setView({ kind: "sessions", projectId });
    launchMutation.mutate({ projectId, harness, pendingKey: pendingId() });
  };

  const resumeSession = (projectId: string, session: SessionDto, harness: string | null): void => {
    setView({ kind: "sessions", projectId });
    resumeMutation.mutate({ projectId, session, harness });
  };

  const submitRename = (session: SessionDto, value: string): void => {
    setEditing(null);
    const label = value.trim() === "" ? null : value.trim();
    renameMutation.mutate({ session, label });
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
      if (isPendingId(item.session.id)) {
        say("still provisioning — the row fills in when the workspace answers");
      } else if (LIVE_STATUSES.has(item.session.status)) {
        void attachFlow(item.session);
      } else {
        setView({ kind: "picker", projectId: view.projectId, session: item.session });
      }
      return;
    }
    if (item.kind === "harness" && view.kind === "picker") {
      const { projectId, session } = view;
      if (session === null) {
        if (item.harness !== null) startSession(projectId, item.harness);
      } else {
        resumeSession(projectId, session, item.harness);
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
        if (
          view.kind === "sessions" &&
          item !== undefined &&
          item.kind === "session" &&
          !isPendingId(item.session.id)
        ) {
          setEditing(item.session);
        }
        return;
      }
      case "o": {
        const item = items[selectedIndex];
        if (item !== undefined && item.kind === "session" && !isPendingId(item.session.id)) {
          openUrl(`${ctx.config.url}/sessions/${item.session.id}`);
          say(`opened · ${ctx.config.url}/sessions/${item.session.id.slice(0, 8)}…`);
        }
        return;
      }
      case "v": {
        const item = items[selectedIndex];
        if (view.kind !== "sessions" || item === undefined || item.kind !== "session") return;
        if (isPendingId(item.session.id)) {
          say("still provisioning — nothing to review yet");
          return;
        }
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

  let headerContext: ReactNode;
  let footerText: string;
  if (view.kind === "projects") {
    headerContext = (
      <>
        <span attributes={BOLD}>projects</span>
        <span attributes={DIM}>
          {"  "}
          {projects.length} project{projects.length === 1 ? "" : "s"}
        </span>
        {liveTotal > 0 ? <span fg={COBALT}>{`  ${liveTotal} live`}</span> : null}
      </>
    );
    footerText = " ↑↓ move · enter open · r refresh · q quit";
  } else if (view.kind === "sessions") {
    const name = detail?.project.name ?? "?";
    const live = (detail?.sessions ?? []).filter((s) => LIVE_STATUSES.has(s.status)).length;
    headerContext = (
      <>
        <span attributes={BOLD} fg={COBALT}>
          {name}
        </span>
        <span attributes={DIM}> {detail?.project.defaultBranch ?? ""}</span>
        {live > 0 ? <span fg={COBALT}>{`  ${live} live`}</span> : null}
      </>
    );
    footerText = " ↑↓ move · enter attach/resume · v review · o web · n new · e rename · q quit";
  } else {
    const forSession = view.session;
    headerContext = (
      <>
        <span attributes={BOLD}>
          {forSession === null ? "new session" : `resume ${forSession.id.slice(0, 8)}`}
        </span>
        <span attributes={DIM}>
          {"  "}
          {forSession === null
            ? "pick a harness — a fresh worktree, recorded from the first keystroke"
            : "pick a harness — same worktree, restored state"}
        </span>
      </>
    );
    footerText = " ↑↓ move · enter start · esc back";
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

  const ink = editorInk(renderer.themeMode);

  return (
    <box flexGrow={1} flexDirection="column">
      <box height={1} marginTop={1} flexDirection="row" justifyContent="space-between">
        <text height={1}>
          <span attributes={DIM}> mend </span>
          {headerContext}
        </text>
        <text height={1} attributes={DIM}>
          {`${ctx.config.url}  `}
        </text>
      </box>

      <scrollbox ref={scrollRef} flexGrow={1} flexShrink={1} minHeight={0} marginTop={1}>
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
          <text height={1} attributes={DIM}>
            {"  no sessions yet — n starts one"}
          </text>
        ) : null}
        {loadFailure !== null ? (
          <text height={1} fg={AMBER}>
            {`  ${loadFailure} — retrying`}
          </text>
        ) : null}
      </scrollbox>

      {editing === null ? null : (
        <box
          border
          borderStyle="rounded"
          borderColor={COBALT}
          title={` label — ${editing.harness} ${editing.id.slice(0, 8)} `}
          titleAlignment="left"
          height={3}
          flexShrink={0}
        >
          <input
            focused
            value={editing.label ?? ""}
            placeholder="a few words for what this session is doing (empty clears)"
            backgroundColor="transparent"
            focusedBackgroundColor="transparent"
            textColor={ink}
            focusedTextColor={ink}
            placeholderColor={GRAY}
            cursorColor={ink}
            flexGrow={1}
            onSubmit={(value: unknown) => {
              if (typeof value === "string") submitRename(editing, value);
            }}
          />
        </box>
      )}

      <StatusLine busy={busy} busyStarted={busyStarted} status={status} />
      <text height={1} attributes={DIM}>
        {editing === null ? footerText : " enter save · esc cancel"}
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

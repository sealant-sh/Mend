// Illustrative data while the platform API lands — shaped after the product
// model in MEND-AGENT-WORKBENCH-PLAN.md §5: projects, sessions, changes.
// Status words are factual (§16.4): running, waiting, completed, observed.

import type { DiffLine, RecordEvent } from "@/components/record";
import type { StatusTone } from "@/components/status";

export type SessionState = "running" | "waiting" | "completed" | "failed" | "stopped";

export interface ChangedFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

export interface Change {
  readonly files: ReadonlyArray<ChangedFile>;
  readonly checksObserved: number;
  readonly notExercised?: string;
  readonly reviewed: boolean;
  readonly diffPeek: { readonly file: string; readonly lines: ReadonlyArray<DiffLine> };
}

export interface Session {
  readonly id: string;
  readonly runId: string;
  readonly harness: "Claude Code" | "Codex" | "OpenCode";
  readonly projectId: string;
  readonly title: string;
  readonly state: SessionState;
  readonly statusWord: string;
  readonly statusTone: StatusTone;
  readonly startedAt: string;
  readonly eventCount: number;
  readonly contextPack?: string;
  readonly events: ReadonlyArray<RecordEvent>;
  readonly terminal?: ReadonlyArray<string>;
  readonly change?: Change;
}

export interface ContextPack {
  readonly name: string;
  readonly items: number;
}

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly branch: string;
  readonly headSha: string;
  readonly storePath: string;
  readonly contextPacks: ReadonlyArray<ContextPack>;
}

export const machine = {
  name: "yiannis-desktop",
  tailnet: "yiannis-desktop.tailnet-1a2b.ts.net",
  binding: "loopback + tailnet",
  reachable: true,
} as const;

export const projects: ReadonlyArray<Project> = [
  {
    id: "newsroom-api",
    name: "newsroom-api",
    branch: "main",
    headSha: "4c9f21e",
    storePath: "~/.mend/store/newsroom-api",
    contextPacks: [
      { name: "Authentication service", items: 5 },
      { name: "Digest pipeline", items: 3 },
    ],
  },
  {
    id: "sealantd",
    name: "sealantd",
    branch: "main",
    headSha: "f695f4c",
    storePath: "~/.mend/store/sealantd",
    contextPacks: [{ name: "PTY supervision", items: 4 }],
  },
  {
    id: "mend",
    name: "mend",
    branch: "main",
    headSha: "3402973",
    storePath: "~/.mend/store/mend",
    contextPacks: [{ name: "Workbench plan", items: 2 }],
  },
];

export const sessions: ReadonlyArray<Session> = [
  {
    id: "s-newsroom-auth",
    runId: "run mnd_4c7t",
    harness: "Claude Code",
    projectId: "newsroom-api",
    title: "Replace the legacy session validation path",
    state: "waiting",
    statusWord: "Waiting for you",
    statusTone: "waiting",
    startedAt: "09:41",
    eventCount: 87,
    contextPack: "Authentication service",
    events: [
      { seq: 1, offset: "00:00.000", name: "workspace.ready" },
      { seq: 14, offset: "00:07.115", name: "process.started", detail: "pnpm install" },
      { seq: 31, offset: "00:14.628", name: "process.exited", detail: "exit 0" },
      { seq: 58, offset: "01:02.334", name: "file.modified", detail: "src/auth/session.ts" },
      { seq: 86, offset: "02:11.902", name: "harness.waiting", detail: "approval requested" },
    ],
    terminal: [
      "$ pnpm test src/auth",
      "  session.test.ts — 12 passed",
      "May I remove the legacy fallback in verifySession()?",
      "  It is still referenced from cron/cleanup.ts.",
    ],
  },
  {
    id: "s-sealantd-watcher",
    runId: "run mnd_x9k2",
    harness: "Codex",
    projectId: "sealantd",
    title: "Construct platform errors with their full shape in the PTY watcher",
    state: "completed",
    statusWord: "Completed · observed",
    statusTone: "observed",
    startedAt: "08:12",
    eventCount: 212,
    contextPack: "PTY supervision",
    events: [
      { seq: 1, offset: "00:00.000", name: "workspace.ready" },
      { seq: 96, offset: "03:40.221", name: "file.modified", detail: "src/pty/watcher.ts" },
      { seq: 154, offset: "06:02.510", name: "process.exited", detail: "pnpm test · exit 0" },
      { seq: 211, offset: "08:19.077", name: "process.exited", detail: "tsgo --noEmit · exit 0" },
    ],
    change: {
      files: [
        { path: "src/pty/watcher.ts", additions: 41, deletions: 12 },
        { path: "src/pty/bridge.ts", additions: 14, deletions: 3 },
        { path: "src/errors.ts", additions: 9, deletions: 3 },
        { path: "test/pty-watcher.test.ts", additions: 22, deletions: 0 },
      ],
      checksObserved: 2,
      notExercised: "daemon restart path never ran",
      reviewed: false,
      diffPeek: {
        file: "src/pty/watcher.ts",
        lines: [
          { sign: " ", text: "if (exit.code !== 0) {" },
          { sign: "-", text: "  throw new SealantPlatformError(msg)" },
          { sign: "+", text: "  throw SealantPlatformError.fromExit(exit, msg)" },
          { sign: " ", text: "}" },
        ],
      },
    },
  },
  {
    id: "s-mend-store",
    runId: "run mnd_7fq9",
    harness: "OpenCode",
    projectId: "mend",
    title: "Adopt repositories into the central store",
    state: "running",
    statusWord: "Running",
    statusTone: "live",
    startedAt: "10:03",
    eventCount: 45,
    contextPack: "Workbench plan",
    events: [
      { seq: 1, offset: "00:00.000", name: "workspace.ready" },
      { seq: 9, offset: "00:05.402", name: "process.started", detail: "pnpm install" },
      { seq: 22, offset: "00:19.310", name: "process.exited", detail: "exit 0" },
      { seq: 38, offset: "01:24.190", name: "file.modified", detail: "src/store/adopt.ts" },
      { seq: 45, offset: "01:41.007", name: "process.started", detail: "pnpm test" },
    ],
    terminal: ["$ pnpm test", " RUN  v3.2.4 packages/store", " ✓ adopt.test.ts (9)", "…"],
  },
  {
    id: "s-newsroom-digest",
    runId: "run mnd_2rw8",
    harness: "Claude Code",
    projectId: "newsroom-api",
    title: "Timezone off-by-one in the morning digest",
    state: "completed",
    statusWord: "Completed · observed",
    statusTone: "observed",
    startedAt: "yesterday",
    eventCount: 156,
    events: [
      { seq: 1, offset: "00:00.000", name: "workspace.ready" },
      { seq: 155, offset: "11:30.412", name: "process.exited", detail: "pnpm test · exit 0" },
    ],
    change: {
      files: [{ path: "src/digest/schedule.ts", additions: 6, deletions: 4 }],
      checksObserved: 1,
      reviewed: true,
      diffPeek: {
        file: "src/digest/schedule.ts",
        lines: [
          { sign: "-", text: "const day = utcDay(now)" },
          { sign: "+", text: "const day = zonedDay(now, tz)" },
        ],
      },
    },
  },
];

export function projectById(id: string): Project | undefined {
  return projects.find((p) => p.id === id);
}

export function sessionById(id: string): Session | undefined {
  return sessions.find((s) => s.id === id);
}

export function sessionsForProject(projectId: string): ReadonlyArray<Session> {
  return sessions.filter((s) => s.projectId === projectId);
}

export function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function changeStats(change: Change): string {
  const adds = change.files.reduce((n, f) => n + f.additions, 0);
  const dels = change.files.reduce((n, f) => n + f.deletions, 0);
  return `${count(change.files.length, "file")} · +${adds} −${dels}`;
}

import { describe, expect, it } from "vitest";

import {
  deriveRows,
  deriveWorktrees,
  foldGroupStatus,
  liveShellOf,
  markSessionStopped,
  removeWorktreeGroup,
  rowKeyOf,
  type ProjectDetailDto,
  type SessionDto,
  type SessionProcessDto,
  type Workbench,
  type WorktreeDto,
} from "./dashboard-model.ts";

const session = (over: Partial<SessionDto> & { readonly id: string }): SessionDto => ({
  harness: "claude",
  label: null,
  branch: `mend/session/${over.id}`,
  baseSha: "abc",
  baseRef: "main",
  status: "completed",
  summary: null,
  createdAt: "2026-08-31T10:00:00.000Z",
  ...over,
});

const worktree = (over: Partial<WorktreeDto> & { readonly id: string }): WorktreeDto => ({
  name: over.id,
  directory: over.id,
  branch: `mend/${over.id}`,
  baseSha: "abc",
  baseRef: "main",
  createdAt: "2026-08-31T09:00:00.000Z",
  ...over,
});

const workbench = (detail: ProjectDetailDto): Workbench => ({
  projects: [detail.project],
  details: new Map([[detail.project.id, detail]]),
  servicesBySession: new Map(),
  processesBySession: new Map(),
});

const project = {
  id: "proj-1",
  name: "fixture",
  originUrl: null,
  storePath: "/store",
  defaultBranch: "main",
};

describe("deriveWorktrees", () => {
  it("groups sessions under their real worktrees when the server sends them", () => {
    const data = workbench({
      project,
      sessions: [
        session({ id: "a", worktreeId: "wt-1", status: "running" }),
        session({ id: "b", worktreeId: "wt-1", status: "waiting" }),
        session({ id: "c", worktreeId: "wt-2" }),
      ],
      annotations: [{ sessionId: "a", changeId: "chg-1", openComments: 2, pendingFollowUp: false }],
      worktrees: [
        worktree({ id: "wt-1", name: "fix-auth" }),
        worktree({ id: "wt-2", name: "docs" }),
      ],
    });
    const groups = deriveWorktrees(data, "proj-1");
    expect(groups.map((group) => [group.name, group.sessions.length, group.live])).toEqual([
      ["fix-auth", 2, 2],
      ["docs", 1, 0],
    ]);
    // The change facts ride the group whichever member carried them.
    expect(groups[0]?.annotation?.changeId).toBe("chg-1");
    expect(foldGroupStatus(groups[0]!)).toBe("waiting");
  });

  it("degrades to one pseudo group per session against a pre-worktree server", () => {
    const data = workbench({
      project,
      sessions: [session({ id: "a", branch: "mend/fix-auth" }), session({ id: "b" })],
      annotations: [{ sessionId: "b", changeId: "chg-2", openComments: 0, pendingFollowUp: true }],
    });
    const groups = deriveWorktrees(data, "proj-1");
    expect(groups.map((group) => [group.id, group.name])).toEqual([
      [null, "fix-auth"],
      [null, "session b"],
    ]);
    // Pseudo groups keep their session's review facts.
    expect(groups[1]?.annotation?.changeId).toBe("chg-2");
  });

  it("keeps an optimistic pending session visible before its worktree exists", () => {
    const data = workbench({
      project,
      sessions: [session({ id: "pending-1", status: "starting" })],
      annotations: [],
      worktrees: [],
    });
    const groups = deriveWorktrees(data, "proj-1");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.id).toBeNull();
  });

  it("calls an anonymous worktree by its members' auto-name label", () => {
    const data = workbench({
      project,
      sessions: [
        session({ id: "a", worktreeId: "wt-9", label: "reaper retry storm", status: "running" }),
      ],
      annotations: [],
      worktrees: [worktree({ id: "wt-9", name: "wt-9", branch: "mend/wt/wt-9" })],
    });
    expect(deriveWorktrees(data, "proj-1")[0]?.name).toBe("reaper retry storm");
  });
});

describe("deriveRows", () => {
  it("keeps lone-session worktrees as one combined row and expands shared ones", () => {
    const data = workbench({
      project,
      sessions: [
        session({ id: "a", worktreeId: "wt-1", status: "running" }),
        session({ id: "b", worktreeId: "wt-1" }),
        session({ id: "c", worktreeId: "wt-2", status: "running" }),
      ],
      annotations: [],
      worktrees: [
        worktree({ id: "wt-1", name: "fix-auth" }),
        worktree({ id: "wt-2", name: "docs" }),
      ],
    });
    const rows = deriveRows(deriveWorktrees(data, "proj-1"));
    expect(rows.map(rowKeyOf)).toEqual(["wt:wt-1", "s:a", "s:b", "s:c"]);
    expect(rows.map((row) => row.kind)).toEqual(["worktree", "session", "session", "session"]);
    // The lone-session worktree renders combined: its row still knows its group.
    const last = rows[3];
    expect(last?.kind === "session" && last.group.name).toBe("docs");
  });
});

const proc = (over: Partial<SessionProcessDto> & { readonly id: string }): SessionProcessDto => ({
  kind: "shell",
  harness: null,
  label: null,
  status: "running",
  exitedAt: null,
  ...over,
});

describe("liveShellOf", () => {
  it("reattaches to the newest LIVE shell instead of stacking a new one", () => {
    const processes = [
      proc({
        id: "agent",
        kind: "agent-pty",
        harness: "codex",
        exitedAt: "2026-08-31T10:00:00Z",
        status: "exited",
      }),
      proc({ id: "shell-1" }),
      proc({ id: "shell-2", exitedAt: "2026-08-31T11:00:00Z", status: "exited" }),
    ];
    expect(liveShellOf(processes)?.id).toBe("shell-1");
  });

  it("answers null when nothing live is attachable — a NEW shell is then honest", () => {
    expect(
      liveShellOf([proc({ id: "s", exitedAt: "2026-08-31T11:00:00Z", status: "exited" })]),
    ).toBeNull();
    expect(liveShellOf([])).toBeNull();
  });
});

describe("optimistic verbs", () => {
  const base = () =>
    workbench({
      project,
      sessions: [
        session({ id: "a", worktreeId: "wt-1", status: "running" }),
        session({ id: "b", worktreeId: "wt-2", status: "running" }),
      ],
      annotations: [],
      worktrees: [
        worktree({ id: "wt-1", name: "fix-auth" }),
        worktree({ id: "wt-2", name: "docs" }),
      ],
    });

  it("markSessionStopped settles the row AND drops its live process facts at once", () => {
    const data = {
      ...base(),
      processesBySession: new Map([
        [
          "a",
          [
            {
              id: "p1",
              kind: "agent-pty",
              harness: "codex",
              label: null,
              status: "running",
              exitedAt: null,
            },
          ],
        ],
      ]),
      servicesBySession: new Map([
        [
          "a",
          [
            {
              id: "svc",
              sessionId: "a",
              label: "web",
              status: "reachable",
              workspacePort: 5173,
              protocol: "tcp" as const,
              hostPort: 43100,
            },
          ],
        ],
      ]),
    };
    const patched = markSessionStopped(data, "a");
    const groups = deriveWorktrees(patched, "proj-1");
    const fixAuth = groups.find((group) => group.name === "fix-auth");
    expect(fixAuth?.live).toBe(0);
    expect(fixAuth?.sessions[0]?.session.status).toBe("stopped");
    // The child fact lines vanish with the stop — no stale "running" agent row.
    expect(fixAuth?.sessions[0]?.processes).toEqual([]);
    expect(fixAuth?.sessions[0]?.services).toEqual([]);
    // The other worktree is untouched.
    expect(groups.find((group) => group.name === "docs")?.live).toBe(1);
  });

  it("removeWorktreeGroup drops the group from the rows before the server answers", () => {
    const data = base();
    const groups = deriveWorktrees(data, "proj-1");
    const target = groups.find((group) => group.name === "docs");
    const patched = removeWorktreeGroup(data, "proj-1", target!);
    const names = deriveWorktrees(patched, "proj-1").map((group) => group.name);
    expect(names).toEqual(["fix-auth"]);
  });
});

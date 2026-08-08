// Expanded 03 — One worktree per session: adopt, launch two agents, then the
// punchline — git status on your own checkout is clean. The disk tree shows
// what the commands leave behind; the fleet cell shows the web surface.

import {
  am,
  cb,
  Cell,
  CellLabel,
  CopyBlock,
  d,
  FactsBar,
  g,
  o,
  PhoneShell,
  PhoneTabs,
  type Step,
  TermFrame,
  TermSurface,
  useTermPlayer,
} from "#/components/expanded/shared";

const S1 = "0198a3c2-7f41-7d2e-9b06-4e1c22a90d17";
const S2 = "0198a3d9-2b60-7c11-8e4f-9a5b31c40e88";

const SCRIPT: ReadonlyArray<Step> = [
  { kind: "chapter", label: "adopt" },
  { kind: "cmd", text: "mend adopt" },
  {
    kind: "lines",
    delay: 300,
    lines: [
      [g("✓ adopted"), o(" · newsroom-api · "), d("~/.mend/store/newsroom-api")],
      [d("  default branch main")],
      [
        d("  sessions start with: "),
        o("mend codex"),
        d(" (from anywhere — "),
        o("--project newsroom-api"),
        d(")"),
      ],
    ],
  },
  { kind: "pause", ms: 900 },
  { kind: "chapter", label: "two sessions" },
  { kind: "cmd", text: "mend claude" },
  {
    kind: "lines",
    delay: 280,
    lines: [
      [g("✓ worktree "), d(`session-${S1}`), d(" · branch "), d(`mend/session/${S1}`)],
      [g("✓ base "), d("3f8c2e91ab04"), d(" · session 0198a3c2")],
      [cb(`  watch · http://localhost:3105/sessions/${S1}`)],
    ],
  },
  {
    kind: "spinner",
    label: "provisioning workspace — a first launch builds the harness image (can take minutes)…",
    secs: 4,
    resolve: [[g("✓ recording"), o(" · workspace mounts the worktree · detach: "), d("Ctrl+]")]],
  },
  {
    kind: "lines",
    delay: 400,
    lines: [[d("  [ claude — the harness's own TUI takes the terminal, recorded ]")]],
  },
  { kind: "pause", ms: 1100 },
  {
    kind: "key",
    chip: "Ctrl+]",
    lines: [[am("detached"), o(" — the session keeps running; reattach: mend attach 0198a3c2")]],
  },
  { kind: "pause", ms: 600 },
  { kind: "cmd", text: "mend codex" },
  {
    kind: "lines",
    delay: 280,
    lines: [
      [g("✓ worktree "), d(`session-${S2}`), d(" · branch "), d(`mend/session/${S2}`)],
      [g("✓ base "), d("3f8c2e91ab04"), d(" · session 0198a3d9")],
      [g("✓ recording"), o(" · workspace mounts the worktree · detach: "), d("Ctrl+]")],
    ],
  },
  {
    kind: "key",
    chip: "Ctrl+]",
    lines: [[am("detached"), o(" — the session keeps running; reattach: mend attach 0198a3d9")]],
  },
  { kind: "pause", ms: 700 },
  { kind: "chapter", label: "your checkout" },
  { kind: "cmd", text: "mend status" },
  {
    kind: "lines",
    delay: 260,
    lines: [
      [o("claude  "), d("0198a3c2"), o("  running  "), d(`mend/session/${S1}`)],
      [o("codex   "), d("0198a3d9"), o("  running  "), d(`mend/session/${S2}`)],
    ],
  },
  { kind: "pause", ms: 900 },
  { kind: "cmd", text: "git status" },
  {
    kind: "lines",
    delay: 300,
    lines: [[o("On branch main")], [o("nothing to commit, working tree clean")]],
  },
  { kind: "pause", ms: 3200 },
];

const TREE: ReadonlyArray<readonly [string, string, string]> = [
  ["~/.mend/store/", "", ""],
  ["  newsroom-api/", "", ""],
  ["    repo.git/", "bare · canonical", ""],
  ["      info/exclude", "# mend: dependency stores are not review content", ""],
  ["      refs/mend/checkpoints/0198a3c2…/1", "seq 412", ""],
  ["    worktrees/", "", ""],
  ["      session-0198a3c2…/", "→ mend/session/0198a3c2…", ""],
  ["      session-0198a3d9…/", "→ mend/session/0198a3d9…", ""],
  ["    sessions/01989f11…/", "harvested at settle", ""],
  ["      harness-state.tar.gz · transcript.native", "", ""],
  ["      session.canonical.json · manifest.json", "", ""],
  ["  _references/zod/", "→ /workspace/ref/zod", ""],
];

export function ExpandedWorktrees() {
  const { state, advance, jump, chapters } = useTermPlayer(SCRIPT);

  return (
    <div className="grid h-full gap-px overflow-hidden bg-[var(--sw-soft-rule)] max-lg:grid-cols-1 lg:grid-cols-12 lg:grid-rows-[minmax(0,5fr)_minmax(0,4fr)_auto]">
      <Cell className="flex flex-col justify-center p-7 sm:p-8 lg:col-span-3">
        <CopyBlock index={2} title="One worktree per session">
          <p>
            Every session works in its own private copy of the repository — so five agents can run
            at once without stepping on each other, and none of them ever touches your checkout.
            Your working copy stays exactly as you left it.
          </p>
          <p>
            <code>mend adopt</code> clones the repo once into a central store on the server. Each
            session then gets its own git worktree and branch cut from that store, and progress is
            snapshotted to hidden git refs as the agent works — nothing appears on a visible branch
            until you've reviewed it.
          </p>
        </CopyBlock>
      </Cell>

      {/* the demo */}
      <Cell className="flex flex-col p-5 max-lg:hidden lg:col-span-6 lg:row-span-2">
        <div className="flex shrink-0 items-center justify-end gap-1.5">
          {chapters.map((chapter) => (
            <button
              key={chapter.label}
              type="button"
              onClick={() => jump(chapter.idx)}
              className={`cursor-pointer rounded px-1.5 py-0.5 font-mono text-[9.5px] transition-colors ${
                state.idx >= chapter.idx ? "text-info" : "text-faint hover:text-muted-foreground"
              }`}
            >
              {chapter.label}
            </button>
          ))}
        </div>
        <TermFrame title="~/code/newsroom-api" className="mt-2 min-h-0 flex-1">
          <TermSurface
            steps={SCRIPT}
            state={state}
            advance={advance}
            className="h-full overflow-hidden"
          />
        </TermFrame>
      </Cell>

      {/* the fleet — the web surface */}
      <Cell className="p-6 max-lg:hidden lg:col-span-3">
        <CellLabel>the project page</CellLabel>
        <p className="font-sans text-[13px] font-medium text-foreground">newsroom-api</p>
        <p className="mt-0.5 truncate font-mono text-[9.5px] text-faint">
          store ~/.mend/store/newsroom-api · main@3f8c2e9 · origin github.com/acme/newsroom-api
        </p>
        <div className="mt-3 divide-y divide-[var(--sw-faint-rule)]">
          {[
            ["claude", "0198a3c2", "Running · recording", "accent", true],
            ["codex", "0198a3d9", "Running · recording", "accent", false],
            ["opencode", "01989f11", "Completed · observed", "green", false],
          ].map(([harness, id, word, tone, forwards]) => (
            <div key={String(id)} className="py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-sans text-[12px] font-medium text-foreground">
                  {String(harness)}
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className={`size-1.5 rounded-full ${tone === "accent" ? "mend-status-running bg-[var(--sw-accent)]" : "bg-success-dot"}`}
                    aria-hidden="true"
                  />
                  <span
                    className={`font-sans text-[10px] font-medium ${tone === "accent" ? "text-info" : "text-success"}`}
                  >
                    {String(word)}
                  </span>
                </span>
              </div>
              <p className="truncate font-mono text-[9.5px] text-faint">
                mend/session/{String(id)}… · base 3f8c2e91ab04
              </p>
              {forwards === true ? (
                <p className="mt-0.5 font-mono text-[9.5px] text-faint">
                  {"  "}Listening on 5173 · observed · <span className="text-info">open</span>
                </p>
              ) : null}
            </div>
          ))}
        </div>
        <p className="mt-1 font-mono text-[9.5px] text-faint">
          start a session: [claude] [codex] [opencode]
        </p>
      </Cell>

      {/* store on disk + phone */}
      <Cell className="p-6 max-lg:hidden lg:col-span-3 lg:col-start-1 lg:row-start-2">
        <CellLabel>the store on disk</CellLabel>
        <div className="font-mono text-[9.5px] leading-[1.75]">
          {TREE.map(([path, note]) => (
            <p key={path} className="truncate whitespace-pre text-ink-2">
              {path}
              {note === "" ? null : <span className="text-faint"> · {note}</span>}
            </p>
          ))}
        </div>
      </Cell>

      <Cell className="flex items-center justify-center p-5 max-lg:hidden lg:col-span-3 lg:col-start-10 lg:row-start-2">
        <div className="[zoom:0.72]">
          <PhoneShell>
            <div className="shrink-0 border-b border-[var(--sw-soft-rule)] px-3.5 pb-2">
              <p className="font-sans text-[11px] font-semibold text-foreground">
                Adopt a repository
              </p>
            </div>
            <div className="min-h-0 flex-1 space-y-2 px-3.5 py-2.5">
              <p className="font-sans text-[8.5px] leading-snug text-muted-foreground">
                Clones into the central store on the server; sessions run in worktrees from that
                copy, never your checkout.
              </p>
              <p className="font-mono text-[8.5px] text-faint">github · yiannis</p>
              <div className="rounded-md border border-input bg-panel px-2 py-1 font-mono text-[8.5px] text-faint">
                Search github — empty shows your latest
              </div>
              {["acme/newsroom-api", "acme/sealantd", "acme/mend-playground"].map((repo, i) => (
                <div key={repo} className="flex items-center justify-between">
                  <span
                    className={`font-mono text-[8.5px] ${i === 0 ? "text-foreground" : "text-muted-foreground"}`}
                  >
                    {repo}
                  </span>
                  {i === 0 ? <span className="font-mono text-[8.5px] text-info">✓</span> : null}
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-[var(--sw-faint-rule)] pt-2">
                <span className="rounded-md bg-primary px-2 py-1 font-sans text-[8.5px] font-medium text-primary-foreground">
                  Adopting…
                </span>
                <span className="flex items-center gap-1">
                  <span
                    className="mend-status-running size-1 rounded-full bg-[var(--sw-accent)]"
                    aria-hidden="true"
                  />
                  <span className="font-sans text-[8px] text-info">cloning into the store</span>
                </span>
              </div>
            </div>
            <PhoneTabs active="projects" />
          </PhoneShell>
        </div>
      </Cell>

      <FactsBar
        items={[
          "git clone --bare <src> → ~/.mend/store/<name>/repo.git · MEND_STORE_ROOT overrides",
          "git worktree add -b mend/session/<id> worktrees/session-<id> <baseSha>",
          "refs/mend/checkpoints/<sessionId>/<n> · each commit stamped with the record seq",
          "mounts: /workspace/repo · /workspace/ref/<name> read-only · /workspace/home/<name> read-only by default",
          'info/exclude → "# mend: dependency stores are not review content"',
        ]}
      />
    </div>
  );
}

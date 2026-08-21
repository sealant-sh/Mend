// Expanded 02 — Sessions outlive harnesses: a claude session resumed as
// codex, walked in four chapters (settle · store · resume · detach). The
// fidelity ladder states what crosses; the checkpoint timeline shows indices
// counting through the switch.

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
  type Step,
  TermFrame,
  TermSurface,
  useTermPlayer,
} from "#/components/expanded/shared";

const SID = "8f3c92e1-77b4-4e0d-9c52-d41a6b3f08e2";
const SID8 = "8f3c92e1";

const SCRIPT: ReadonlyArray<Step> = [
  { kind: "chapter", label: "settle" },
  {
    kind: "lines",
    delay: 200,
    lines: [
      [g("✓ session completed"), o(" · recorded")],
      [cb(`  review · http://localhost:3105/sessions/${SID}`)],
    ],
  },
  { kind: "pause", ms: 900 },
  { kind: "chapter", label: "store" },
  { kind: "cmd", text: `ls ~/.config/mend/store/newsroom-api/sessions/${SID}/` },
  {
    kind: "lines",
    delay: 240,
    lines: [[o("harness-state.tar.gz  manifest.json  session.canonical.json  transcript.native")]],
  },
  { kind: "cmd", text: "cat ~/.config/mend/store/newsroom-api/sessions/8f3c92e1-*/manifest.json" },
  {
    kind: "lines",
    delay: 240,
    lines: [
      [o('{"harness":"claude","providerSessionId":"c0ffee12-9a41-4a77-b0cd-5efc02a1d9b3",')],
      [o(' "capturedAt":"2026-08-09T14:12:31Z"}')],
    ],
  },
  { kind: "pause", ms: 1300 },
  { kind: "chapter", label: "resume" },
  { kind: "cmd", text: `mend resume ${SID8} --with codex` },
  {
    kind: "lines",
    delay: 260,
    lines: [
      [g("✓ resuming claude"), o(" · "), d(SID8), d(" as "), o("codex")],
      [cb(`  watch · http://localhost:3105/sessions/${SID}`)],
    ],
  },
  {
    kind: "spinner",
    label: "resuming — a fresh workspace restores the saved session state…",
    secs: 4,
    resolve: [
      [g("✓ recording"), o(" · same worktree, conversation restored · detach: "), d("Ctrl+]")],
    ],
  },
  {
    kind: "raw",
    tui: { name: "codex", banner: ["resumed session · 23 earlier turns — representative render"] },
  },
  {
    kind: "lines",
    delay: 350,
    lines: [
      [d("› keep the cookie contract — maxAge stays 604800; add the regression test")],
      [o("Added test/auth/cookie-contract.test.ts covering maxAge and SameSite;")],
      [o("ran pnpm test — 41 passed.")],
    ],
  },
  { kind: "pause", ms: 2000 },
  { kind: "chapter", label: "detach" },
  { kind: "raw", tui: null },
  {
    kind: "key",
    chip: "Ctrl+]",
    lines: [[am("detached"), o(" — the session keeps running; reattach: mend attach "), o(SID8)]],
  },
  { kind: "cmd", text: "mend status" },
  {
    kind: "lines",
    delay: 260,
    lines: [[o("codex  "), d(SID8), o("  running  "), d(`mend/session/${SID}`)]],
  },
  { kind: "pause", ms: 3000 },
];

const LADDER: ReadonlyArray<readonly [string, string]> = [
  ["user/assistant text", "byte-exact"],
  ["reasoning", "text crosses · provider-encrypted blobs dropped"],
  ["shell", "mapped to the target's own shell item (Bash ↔ exec_command)"],
  ["other tools", "structured passthrough"],
];

export function ExpandedHarness() {
  const { state, advance, jump, chapters } = useTermPlayer(SCRIPT);

  return (
    <div className="grid h-full gap-px overflow-hidden bg-[var(--sw-soft-rule)] max-lg:grid-cols-1 lg:grid-cols-12 lg:grid-rows-[minmax(0,5fr)_minmax(0,4fr)_auto]">
      <Cell className="flex flex-col justify-center p-7 sm:p-8 lg:col-span-3">
        <CopyBlock index={1} title="Sessions outlive harnesses">
          <p>
            A session is the work itself: the code being changed, the full history of what happened,
            and the context it started with. The agent tool driving it — claude, codex, opencode —
            is just a field on it. So you can stop working in one tool and continue the same session
            in another, without losing the conversation or starting over.
          </p>
          <p>
            When a session ends, Mend saves the tool's own state files plus a tool-neutral copy of
            the conversation. Resume with the same tool and it restores natively; resume{" "}
            <code>--with codex</code> and Mend rewrites the saved conversation into codex's own
            format, so it opens the history as its own session. Anything that can't be expressed
            crosses as a summary that marks what it left out.
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

      {/* fidelity ladder */}
      <Cell className="p-6 max-lg:hidden lg:col-span-3">
        <CellLabel>what crosses a harness switch</CellLabel>
        <div className="divide-y divide-[var(--sw-faint-rule)]">
          {LADDER.map(([kind, rule]) => (
            <div key={kind} className="flex items-baseline gap-3 py-1.5">
              <span className="w-[9rem] shrink-0 font-mono text-[10.5px] text-ink-2">{kind}</span>
              <span className="font-mono text-[10.5px] leading-relaxed text-muted-foreground">
                {rule}
              </span>
            </div>
          ))}
          <p className="pt-2 font-mono text-[10px] leading-relaxed text-faint">
            inexpressible pairs → distilled opening prompt · elisions marked "(&lt;n&gt; earlier
            turns elided.)"
          </p>
        </div>
      </Cell>

      {/* record continuity + resume-with + phone share the lower-right band */}
      <Cell className="p-6 max-lg:hidden lg:col-span-3 lg:row-start-2 lg:col-start-1">
        <CellLabel>checkpoints across the switch</CellLabel>
        <div className="font-mono text-[10.5px] leading-relaxed">
          <p className="text-faint">claude</p>
          <p className="text-ink-2">
            3 · turn-boundary <span className="text-faint">· seq 1841</span>
          </p>
          <p className="text-ink-2">
            4 · turn-boundary <span className="text-faint">· seq 2016</span>
          </p>
          <div className="my-1.5 flex items-center gap-2">
            <span className="h-px flex-1 bg-[var(--sw-soft-rule)]" aria-hidden="true" />
            <span className="text-faint">claude → codex</span>
            <span className="h-px flex-1 bg-[var(--sw-soft-rule)]" aria-hidden="true" />
          </div>
          <p className="text-faint">codex</p>
          <p className="text-ink-2">
            5 · turn-boundary <span className="text-faint">· seq 2233</span>
          </p>
          <p className="mt-2 text-faint">
            refs/mend/checkpoints/{SID8}…/&lt;n&gt; — indices keep counting
          </p>
        </div>
        <div className="mt-5 border-t border-[var(--sw-faint-rule)] pt-4">
          <p className="font-sans text-[11px] text-label">resume with:</p>
          <div className="mt-1.5 flex gap-1.5">
            {["claude", "codex", "opencode"].map((harness) => (
              <span
                key={harness}
                className={`rounded-lg border px-2.5 py-1 font-mono text-[10.5px] shadow-[var(--shadow-xs)] ${
                  harness === "claude"
                    ? "border-[color-mix(in_oklab,var(--sw-accent)_45%,transparent)] text-foreground"
                    : "border-border text-muted-foreground"
                }`}
              >
                {harness}
              </span>
            ))}
          </div>
          <p className="mt-1.5 font-mono text-[9.5px] text-faint">
            the session page, once a session settles
          </p>
        </div>
      </Cell>

      <Cell className="flex flex-col items-center justify-center gap-2.5 p-5 max-lg:hidden lg:col-span-3 lg:col-start-10 lg:row-start-2">
        <div className="[zoom:0.68]">
          <PhoneShell>
            <div className="shrink-0 border-b border-[var(--sw-soft-rule)] px-3.5 pb-2">
              <p className="font-mono text-[9px] text-faint">session</p>
              <p className="truncate font-sans text-[11px] font-semibold text-foreground">
                claude — cookie contract regression test
              </p>
              <p className="mt-1 flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-success-dot" aria-hidden="true" />
                <span className="font-sans text-[9.5px] font-medium text-success">
                  Completed · observed
                </span>
              </p>
            </div>
            <div className="flex shrink-0 gap-1 px-3.5 py-2">
              {["Review", "Resume", "Terminal", "Stop"].map((action, i) => (
                <span
                  key={action}
                  className={`rounded-md border px-1.5 py-0.5 font-sans text-[8.5px] font-medium ${
                    i === 1
                      ? "border-[color-mix(in_oklab,var(--sw-accent)_45%,transparent)] text-foreground"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {action}
                </span>
              ))}
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-hidden border-t border-[var(--sw-faint-rule)] px-3.5 py-2.5">
              <p className="ml-6 rounded-lg bg-[var(--sw-sunken)] px-2 py-1.5 font-sans text-[9px] leading-snug text-foreground">
                keep the cookie contract — maxAge stays 604800; add the regression test
              </p>
              <p className="font-sans text-[9px] leading-snug text-muted-foreground">
                Added test/auth/cookie-contract.test.ts covering maxAge and SameSite; ran pnpm test
                — 41 passed.
              </p>
              <p className="font-mono text-[8.5px] text-faint">$ pnpm test · 41 passed</p>
            </div>
            <div className="shrink-0 border-t border-[var(--sw-faint-rule)] px-3.5 py-2 pb-4">
              <p className="rounded-lg border border-input bg-panel px-2 py-1 font-sans text-[8.5px] text-faint">
                Message the session…
              </p>
            </div>
          </PhoneShell>
        </div>
        <p className="max-w-[16rem] text-center font-mono text-[9.5px] leading-relaxed text-faint">
          the phone renders the canonical record, not the native transcript — after a --with switch
          this same screen reads straight through both eras
        </p>
      </Cell>

      <FactsBar
        items={[
          "~/.config/mend/store/<project>/sessions/<id>/ · harness-state.tar.gz · transcript.native · session.canonical.json · manifest.json",
          "same-harness resume is native: claude --resume <providerSessionId>",
          "cross-harness invariant: ingest(emit(ingest(x))) ≡ ingest(x)",
          "refs/mend/checkpoints/<sessionId>/<n> — indices keep counting across a switch",
          "mend resume [session-id] [--with h] — rejoin a settled session",
        ]}
      />
    </div>
  );
}

// Expanded 05 — Context packs from sessions: scrub · select · promote · save
// · launch. The pack is alive, the snapshot is evidence — the final beat
// edits the pack after launch and the launched session's snapshot line does
// not move.

import { type PointerEvent as ReactPointerEvent, useState } from "react";

import {
  Cell,
  CellLabel,
  CopyBlock,
  FactsBar,
  PhoneShell,
  PhoneTabs,
} from "#/components/expanded/shared";

const CHECKPOINTS: ReadonlyArray<readonly [number, string, number]> = [
  [0, "session-start", 0],
  [1, "turn-boundary", 412],
  [2, "turn-boundary", 1268],
  [3, "user-mark", 2044],
  [4, "review-open", 2871],
  [5, "turn-boundary", 3184],
];
const MAX_SEQ = 3184;

type Phase = "scrub" | "picker" | "editor" | "saved" | "launched" | "stale";

export function ExpandedContext() {
  const [seq, setSeq] = useState(2044);
  const [phase, setPhase] = useState<Phase>("scrub");
  const [selected, setSelected] = useState(false);

  const nearest = CHECKPOINTS.reduce((a, b) =>
    Math.abs(b[2] - seq) < Math.abs(a[2] - seq) ? b : a,
  );

  const onScrub = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.buttons === 0 && e.type !== "pointerdown") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setSeq(Math.round(frac * MAX_SEQ));
  };

  const version = phase === "stale" ? 13 : phase === "saved" || phase === "launched" ? 12 : 11;

  return (
    <div className="grid h-full gap-px overflow-hidden bg-[var(--sw-soft-rule)] max-lg:grid-cols-1 lg:grid-cols-12 lg:grid-rows-[minmax(0,1fr)_auto]">
      {/* the store demo — dominant */}
      <Cell className="flex min-h-0 flex-col p-5 max-lg:hidden lg:col-span-8">
        <div className="flex shrink-0 items-center justify-between">
          <p className="font-mono text-[10px] text-faint">
            scrub · select · promote · save · launch
          </p>
          <button
            type="button"
            onClick={() => {
              setPhase("scrub");
              setSelected(false);
              setSeq(2044);
            }}
            className="cursor-pointer font-mono text-[10px] text-muted-foreground hover:text-foreground"
          >
            replay
          </button>
        </div>
        <p className="mt-1 shrink-0 truncate font-mono text-[10px] text-faint">
          claude — legacy SSO callback investigation ·{" "}
          <span className="text-success">Completed · observed</span> · record seq 0–3184
        </p>

        {/* record rail */}
        <div
          className="mt-2.5 shrink-0 cursor-ew-resize touch-none py-1.5"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            onScrub(e);
          }}
          onPointerMove={onScrub}
          role="slider"
          aria-label="Record position"
          aria-valuemin={0}
          aria-valuemax={MAX_SEQ}
          aria-valuenow={seq}
          tabIndex={0}
        >
          <div className="relative h-1.5 rounded-full bg-[var(--sw-sunken)]">
            {CHECKPOINTS.map(([n, , at]) => (
              <span
                key={n}
                className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-[var(--sw-rule)]"
                style={{ left: `${(at / MAX_SEQ) * 100}%` }}
                aria-hidden="true"
              />
            ))}
            <span
              className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--sw-accent)] bg-panel shadow-[var(--shadow-xs)]"
              style={{ left: `${(seq / MAX_SEQ) * 100}%` }}
              aria-hidden="true"
            />
          </div>
          <p className="mt-1 text-right font-mono text-[9.5px] text-faint">
            seq {seq} · checkpoint {nearest[0]} · {nearest[1]}
          </p>
        </div>

        <div className="mt-1 grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          {/* transcript */}
          <div className="min-h-0 space-y-2 overflow-hidden">
            <div className="font-mono text-[9px] text-faint">seq 1962 · tool</div>
            <div className="rounded-lg bg-panel px-2.5 py-1.5 font-mono text-[9.5px] leading-[1.7] shadow-[var(--shadow-xs)]">
              <p className="text-ink-2">$ rg -n "aud" src/auth/legacy-sso.ts</p>
              <p className="text-faint">
                141: if (payload.aud !== undefined && payload.aud !== AUDIENCE)
              </p>
              <p className="text-faint">198: // TODO: audience optional for legacy IdPs</p>
            </div>
            <div className="font-mono text-[9px] text-faint">seq 1984 · assistant</div>
            <button
              type="button"
              onClick={() => {
                setSelected(true);
                if (phase === "scrub") setPhase("picker");
              }}
              className={`w-full cursor-pointer rounded-lg px-2.5 py-1.5 text-left font-sans text-[11px] leading-relaxed shadow-[var(--shadow-xs)] transition-colors ${
                selected
                  ? "bg-[var(--sw-wash)] text-foreground"
                  : "bg-panel text-foreground hover:bg-[var(--sw-wash)]"
              }`}
            >
              The legacy callback verifies the signature but skips the audience check whenever{" "}
              <code className="font-mono text-[0.92em]">aud</code> is absent — that is the 2019 IdP
              compatibility path. The JWT is only a hint here: revocation happens at the session
              row, so database sessions remain authoritative.
              <span className="mt-0.5 block font-mono text-[8.5px] text-faint">
                {selected ? "selected — promote from the record" : "click to select this span"}
              </span>
            </button>
            <div className="font-mono text-[9px] text-faint">seq 2031 · user</div>
            <p className="ml-8 rounded-lg bg-[var(--sw-sunken)] px-2.5 py-1.5 font-sans text-[10.5px] text-foreground">
              good — note that down. sessions stay authoritative, we are not going stateless.
            </p>
            <div className="flex items-center gap-2 font-mono text-[8.5px] text-faint">
              <span className="h-px flex-1 bg-[var(--sw-soft-rule)]" aria-hidden="true" />
              checkpoint 3 · user-mark · seq 2044
              <span className="h-px flex-1 bg-[var(--sw-soft-rule)]" aria-hidden="true" />
            </div>

            {phase === "picker" ? (
              <div className="rounded-xl border border-border bg-panel p-2.5 shadow-[var(--shadow-md)]">
                <p className="font-mono text-[9px] text-faint">Promote from the record</p>
                {[
                  ["decision", "a durable note; provenance pins the exact span"],
                  ["discovery", "something learned about the code; same shape, different word"],
                  ["handoff", "the whole session — generated, then edited before it saves"],
                ].map(([kind, def], i) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => {
                      if (i === 0) setPhase("editor");
                    }}
                    className={`mt-1 flex w-full cursor-pointer items-baseline gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-[var(--sw-wash)] ${i === 0 ? "" : "opacity-70"}`}
                  >
                    <span className="w-16 shrink-0 font-mono text-[10px] text-ink-2">{kind}</span>
                    <span className="font-sans text-[10px] text-muted-foreground">{def}</span>
                  </button>
                ))}
              </div>
            ) : null}

            {phase === "editor" ? (
              <div className="rounded-xl border border-border bg-panel p-2.5 shadow-[var(--shadow-md)]">
                <p className="font-sans text-[11px] font-medium text-foreground">
                  Decision: database sessions remain authoritative
                </p>
                <p className="mt-1 font-sans text-[10px] leading-relaxed text-muted-foreground">
                  The legacy callback verifies the signature but skips the audience check whenever
                  aud is absent… revocation happens at the session row.
                </p>
                <p className="mt-1 font-mono text-[8.5px] text-faint">
                  mend/session/01j9k2m4… · seq 1984–2044 · digest 9f3c21ab
                </p>
                <button
                  type="button"
                  onClick={() => setPhase("saved")}
                  className="mt-1.5 cursor-pointer rounded bg-primary px-2 py-0.5 font-sans text-[10px] font-medium text-primary-foreground shadow-[var(--shadow-cobalt)]"
                >
                  Save to pack · Authentication service
                </button>
              </div>
            ) : null}
          </div>

          {/* pack + launch */}
          <div className="flex min-h-0 flex-col gap-2.5 overflow-hidden">
            <div className="overflow-hidden rounded-xl bg-panel shadow-[var(--shadow-sm)]">
              <div className="flex items-center justify-between border-b border-[var(--sw-faint-rule)] bg-[var(--sw-sunken)] px-3 py-1.5">
                <span className="font-sans text-[11px] font-medium text-foreground">
                  Authentication service
                </span>
                <span className="font-mono text-[9.5px] text-ink-2">auth-service@{version}</span>
              </div>
              <div className="px-3 py-1.5 font-mono text-[9.5px] leading-[1.9]">
                <p className="text-ink-2">
                  AGENTS.md <span className="text-faint">file · 41c9e2</span>
                </p>
                <p className="text-ink-2">
                  docs/authentication.md <span className="text-faint">file · b02ea7</span>
                </p>
                {phase !== "stale" ? (
                  <p className="text-ink-2">
                    docs/legacy-sso.md <span className="text-faint">file · 77d14c</span>
                  </p>
                ) : (
                  <p className="text-faint line-through">docs/legacy-sso.md · removed at @13</p>
                )}
                <p className="text-ink-2">
                  Handoff: legacy callback investigation{" "}
                  <span className="text-faint">handoff_01J8XQ…</span>
                </p>
                {phase === "saved" || phase === "launched" || phase === "stale" ? (
                  <p className="mend-appear text-success">
                    + Decision: database sessions remain authoritative{" "}
                    <span className="text-faint">note · seq 1984–2044</span>
                  </p>
                ) : null}
              </div>
            </div>
            <p className="font-mono text-[8.5px] text-faint">
              packs are editable — every session receives an immutable snapshot
            </p>

            {phase === "saved" || phase === "launched" || phase === "stale" ? (
              <div className="rounded-xl bg-[#16161a] px-3 py-2 font-mono text-[9.5px] leading-[1.85]">
                <p className="text-[#5c5c66]">
                  start a session with this pack:{" "}
                  {(["claude", "codex", "opencode"] as const).map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => {
                        if (phase === "saved") setPhase("launched");
                      }}
                      className={`mr-1 cursor-pointer rounded border px-1 ${h === "codex" && phase !== "saved" ? "border-[#7a9ce8] text-[#e8e8ec]" : "border-[#3a3a42] text-[#8a8a92] hover:text-[#e8e8ec]"}`}
                    >
                      {h}
                    </button>
                  ))}
                </p>
                {phase === "launched" || phase === "stale" ? (
                  <div className="mend-appear">
                    <p className="text-[#7fbf95]">
                      ✓ worktree session-01ja2f7c…{" "}
                      <span className="text-[#5c5c66]">· branch mend/session/01ja2f7c…</span>
                    </p>
                    <p className="text-[#7fbf95]">
                      ✓ base 4f2c19d8ab30 <span className="text-[#5c5c66]">· session 01ja2f7c</span>
                    </p>
                    <p className="text-[#5c5c66]">
                      {"  "}snapshot auth-service@12 · 5 items · immutable
                      {phase === "stale" ? (
                        <span className="mend-appear text-[#cfa14a]">
                          {"  "}← context snapshot stale — the pack moved to @13; this session keeps
                          @12
                        </span>
                      ) : null}
                    </p>
                    <p className="text-[#7a9ce8]">
                      {"  "}watch · http://localhost:3105/sessions/01ja2f7c…
                    </p>
                    <p className="text-[#7fbf95]">
                      ✓ recording{" "}
                      <span className="text-[#b9b9c0]">
                        · workspace mounts the worktree · detach:
                      </span>{" "}
                      <span className="text-[#5c5c66]">Ctrl+]</span>
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {phase === "launched" ? (
              <button
                type="button"
                onClick={() => setPhase("stale")}
                className="cursor-pointer self-start rounded border border-border bg-panel px-2 py-0.5 font-sans text-[10px] font-medium text-foreground"
              >
                edit pack — remove docs/legacy-sso.md
              </button>
            ) : null}
          </div>
        </div>
      </Cell>

      {/* right rail: copy, manifest, refusals, phone */}
      <Cell className="p-6 max-lg:hidden lg:col-span-4 lg:row-span-1">
        <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
          <CopyBlock index={4} title="Context packs from sessions">
            <p>
              Agents forget everything between sessions. Mend's answer is deliberately manual: you
              pick what's worth keeping — a decision, a doc, a summary of a finished session — and
              save it into named packs that the next session starts from. Nothing is remembered
              behind your back.
            </p>
            <p>
              Packs are versioned like code, and a session gets a frozen snapshot of its pack at
              launch — so you can always see exactly what an agent knew, even after the pack has
              moved on.
            </p>
          </CopyBlock>
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
            <div className="min-w-0">
              <CellLabel>the recorded manifest</CellLabel>
              <pre className="overflow-hidden font-mono text-[8.5px] leading-[1.7] text-muted-foreground">{`{ "manifestId": "auth-service@12",
  "items": [
    { "kind": "file",
      "ref": "AGENTS.md",
      "digest": "41c9e2…" },
    { "kind": "note",
      "ref": "decision_01ja…",
      "digest": "9f3c21…" },
    { "kind": "session-handoff",
      "ref": "handoff_01J8XQ…",
      "digest": "c4d902…" } ] }`}</pre>
              <p className="mt-1.5 font-mono text-[8.5px] leading-relaxed text-faint">
                Mend owns selection and presentation. Sealant records the immutable manifest
                attached to the execution.
              </p>
            </div>
            <div className="min-w-0">
              <CellLabel>not in the product</CellLabel>
              <div className="space-y-1 font-sans text-[10.5px] leading-relaxed text-muted-foreground">
                <p>Fully automatic long-term memory.</p>
                <p>Vector-store ingestion of everything.</p>
                <p>Hidden context selection you cannot inspect.</p>
              </div>
              <p className="mt-2 border-t border-[var(--sw-faint-rule)] pt-2 font-mono text-[9px] leading-relaxed text-faint">
                if Mend supplied it, you can see it; if you can see it, it has a digest
              </p>
              <div className="mt-3 flex justify-center">
                <div className="[zoom:0.6]">
                  <PhoneShell>
                    <div className="shrink-0 border-b border-[var(--sw-soft-rule)] px-3.5 pb-1.5">
                      <p className="font-mono text-[9px] text-faint">project</p>
                      <p className="font-sans text-[11px] font-semibold text-foreground">
                        newsroom-api
                      </p>
                    </div>
                    <div className="min-h-0 flex-1 px-3.5 py-2">
                      <p className="font-mono text-[8.5px] text-faint">Sessions</p>
                      <p className="mt-1 truncate font-sans text-[9.5px] font-medium text-foreground">
                        claude — legacy SSO callback investigation
                      </p>
                      <p className="font-mono text-[8px] text-faint">snapshot auth-service@12</p>
                      <p className="mt-1.5 truncate font-sans text-[9.5px] font-medium text-foreground">
                        codex — audience check on legacy callbacks
                      </p>
                      <p className="font-mono text-[8px] text-faint">snapshot auth-service@12</p>
                      <p className="mt-2.5 font-mono text-[8.5px] text-faint">Context packs</p>
                      <p className="mt-1 flex justify-between font-sans text-[9.5px] text-foreground">
                        Authentication service{" "}
                        <span className="font-mono text-[8px] text-faint">4 items · @13</span>
                      </p>
                      <p className="mt-1 flex justify-between font-sans text-[9.5px] text-foreground">
                        Deploy and release{" "}
                        <span className="font-mono text-[8px] text-faint">3 items · @4</span>
                      </p>
                    </div>
                    <PhoneTabs active="projects" />
                  </PhoneShell>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Cell>

      <FactsBar
        items={[
          'manifestId "auth-service@12" — the immutable snapshot recorded against the execution',
          '{ kind: "file", ref: "AGENTS.md", digest: "41c9e2…" } — every item carries provenance and a digest',
          "item kinds: file · directory · doc · note · URL · issue or PR · session handoff",
          "~/.config/mend/store/<project>/sessions/<id>/session.canonical.json — what promotions read",
          "status word: context snapshot stale — an observation about versions, never a verdict",
        ]}
      />
    </div>
  );
}

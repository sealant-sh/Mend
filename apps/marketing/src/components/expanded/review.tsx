// Expanded 04 — Review beside the change: a faithful, interactive change
// page. Six tour stops over one coherent code story (JWT parsing → database
// sessions), draft comments with accept / edit / dismiss, the run-check
// escalation, the assembled follow-up you edit before sending, and the
// mend continue coda. User-driven; j/k also walk the stops.

import { motion } from "framer-motion";
import { useState } from "react";

import {
  Cell,
  CellLabel,
  CopyBlock,
  FactsBar,
  PhoneShell,
  PhoneTabs,
} from "#/components/expanded/shared";

interface DiffLine {
  readonly t: "ctx" | "del" | "add";
  readonly s: string;
}

interface Stop {
  readonly file: string;
  readonly title: string;
  readonly disposition: "observed" | "never ran" | "unexplained" | null;
  readonly lines: ReadonlyArray<DiffLine>;
  readonly note: string;
  readonly chips: ReadonlyArray<string>;
  /** index into CARDS if this stop carries a draft comment */
  readonly card?: number;
}

const FILES: ReadonlyArray<readonly [string, string]> = [
  ["src/auth/validate.ts", "+62 −28"],
  ["src/auth/session.ts", "+3 −3"],
  ["src/auth/refresh.ts", "+41 −6"],
  ["src/auth/legacy-sso.ts", "+9 −38"],
  ["src/db/schema.ts", "+2 −0"],
  ["src/auth/validate.test.ts", "+66 −0"],
];

const STOPS: ReadonlyArray<Stop> = [
  {
    file: "src/auth/validate.ts",
    title: "the main change",
    disposition: "observed",
    lines: [
      { t: "del", s: "export function validateSession(token: string): Claims | null {" },
      { t: "del", s: "  const claims = decodeJwt(token)" },
      {
        t: "add",
        s: "export async function validateSession(token: string): Promise<Claims | null> {",
      },
      { t: "add", s: "  const row = await db.sessions.findByToken(hash(token))" },
      { t: "add", s: "  if (!row || row.expiresAt < now()) return null" },
      { t: "add", s: "  return claimsFromRow(row)" },
    ],
    note: "The instruction's core ask. Rewritten across seqs 1180–1466; pnpm vitest run src/auth/validate.test.ts exited 0 at seq 2790.",
    chips: ["write · seq 1204", "check · exit 0 · seq 2790"],
  },
  {
    file: "src/auth/session.ts",
    title: "instruction vs diff",
    disposition: null,
    lines: [
      { t: "ctx", s: '  name: "nr_session",' },
      { t: "ctx", s: "  httpOnly: true," },
      { t: "del", s: "  maxAge: 604800," },
      { t: "add", s: "  maxAge: 86400," },
      { t: "ctx", s: '  sameSite: "lax",' },
    ],
    note: "",
    chips: [],
    card: 0,
  },
  {
    file: "src/auth/refresh.ts",
    title: "diff vs evidence",
    disposition: null,
    lines: [
      { t: "del", s: "export function rotateRefresh(old: string) {" },
      { t: "del", s: "  return signJwt({ ...decodeJwt(old), exp: now() + WEEK })" },
      { t: "add", s: "export async function rotateRefresh(old: string) {" },
      { t: "add", s: "  const next = await db.sessions.rotate(hash(old))" },
      { t: "add", s: "  if (!next) throw new RefreshReused(old)" },
    ],
    note: "",
    chips: [],
    card: 1,
  },
  {
    file: "src/auth/legacy-sso.ts",
    title: "context vs behavior",
    disposition: null,
    lines: [
      { t: "del", s: "export async function legacySsoCallback(req: Request) {" },
      { t: "del", s: "  const assertion = await parseSaml(req)" },
      { t: "del", s: "  return mintLegacySession(assertion)" },
      { t: "add", s: "export async function legacySsoCallback() {" },
      { t: "add", s: '  throw new GoneError("legacy SSO retired")' },
    ],
    note: "",
    chips: [],
    card: 2,
  },
  {
    file: "src/db/schema.ts",
    title: "unexplained edit",
    disposition: null,
    lines: [
      { t: "ctx", s: '  token: text("token").unique(),' },
      { t: "ctx", s: '  expiresAt: timestamp("expires_at").notNull(),' },
      { t: "add", s: '  lastSeenAt: timestamp("last_seen_at"),' },
    ],
    note: "",
    chips: [],
    card: 3,
  },
  {
    file: "src/auth/validate.test.ts",
    title: "new coverage",
    disposition: "observed",
    lines: [
      { t: "add", s: 'test("expired session row is rejected", async () => {' },
      { t: "add", s: "  const t = await seedSession({ expiresAt: past() })" },
      { t: "add", s: "  expect(await validateSession(t.token)).toBeNull()" },
      { t: "add", s: "})" },
    ],
    note: "New coverage for the rewrite. Ran at seq 2790 · exit 0.",
    chips: [],
  },
];

interface Card {
  readonly body: string;
  readonly chips: ReadonlyArray<string>;
  readonly anchor: string;
  readonly disposition: "divergence" | "never ran" | "unexplained";
  readonly check?: string;
}

const CARDS: ReadonlyArray<Card> = [
  {
    anchor: "line 41–44",
    disposition: "divergence",
    body: "The instruction said keep the cookie contract; maxAge changed — 604800 → 86400. The write at seq 1892 sits in no prompt span that mentions the cookie.",
    chips: ["instruction · seq 12", "write · seq 1892"],
  },
  {
    anchor: "line 1–5",
    disposition: "never ran",
    body: "rotateRefresh was rewritten but no test exercising it ran.",
    chips: [],
    check: "pnpm vitest run src/auth/refresh.test.ts",
  },
  {
    anchor: "line 1–4",
    disposition: "unexplained",
    body: "docs/legacy-sso.md was in the context snapshot and never read — no read event anywhere in seqs 0–2790. The handoff 'legacy callback investigation' in the same snapshot flags partners still on this callback.",
    chips: ["snapshot · auth-service@12", "no read event · seqs 0–2790"],
  },
  {
    anchor: "line 14",
    disposition: "unexplained",
    body: "No prompt span or command output mentions lastSeenAt. Write event seq 2210 is the only trace.",
    chips: ["write · seq 2210"],
  },
];

type CardState = "draft" | "open" | "dismissed" | "sent";
type CheckState = "idle" | "running" | "done";

const INSTRUCTION = (points: ReadonlyArray<string>) =>
  `This is a follow-up on your earlier work in this worktree, responding to review feedback. The branch mend/session/01j9y2kqv3n8tqfwd6h2r8pzae is already checked out with your work on it: keep working there, and do not start a new branch or reset it.

${points.map((point, i) => `${i + 1}. ${point}`).join("\n\n")}

Address each point using your own judgment about how. Check your work with the repository's own build, tests, or typecheck; a check that still fails is something to report, not to force green. Report honestly what you changed and what you did not — if a point cannot or should not be done, say so plainly.`;

export function ExpandedReview() {
  const [stop, setStop] = useState(0);
  const [cards, setCards] = useState<ReadonlyArray<CardState>>([
    "draft",
    "draft",
    "draft",
    "draft",
  ]);
  const [check, setCheck] = useState<CheckState>("idle");
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(CARDS[3]?.body ?? "");
  const [dialog, setDialog] = useState(false);
  const [delivered, setDelivered] = useState(false);

  const current = STOPS[stop];
  const cardIdx = current?.card;
  const card = cardIdx === undefined ? undefined : CARDS[cardIdx];
  const cardState = cardIdx === undefined ? undefined : cards[cardIdx];
  const openCount = cards.filter((s) => s === "open").length;

  const setCard = (i: number, next: CardState) =>
    setCards((all) => all.map((v, j) => (j === i ? next : v)));

  const points = [
    cards[0] !== "dismissed" ? CARDS[0]?.body : null,
    cards[2] !== "dismissed" ? `src/auth/legacy-sso.ts:1-4 — ${CARDS[2]?.body}` : null,
    cards[3] !== "dismissed"
      ? `src/db/schema.ts:14 — ${editText === CARDS[3]?.body ? CARDS[3]?.body : editText}`
      : null,
  ].filter((p): p is string => typeof p === "string" && p.length > 0);

  return (
    <div
      className="grid h-full gap-px overflow-hidden bg-[var(--sw-soft-rule)] max-lg:grid-cols-1 lg:grid-cols-12 lg:grid-rows-[minmax(0,5fr)_minmax(0,3fr)_auto]"
      onKeyDown={(e) => {
        if (e.key === "j") setStop((v) => Math.min(STOPS.length - 1, v + 1));
        if (e.key === "k") setStop((v) => Math.max(0, v - 1));
      }}
    >
      <Cell className="flex flex-col justify-center p-7 sm:p-8 lg:col-span-3 lg:row-span-2">
        <CopyBlock index={3} title="Review beside the change">
          <p>
            When an agent finishes, you review what it actually did — before anything is committed,
            pushed, or turned into a PR. Mend reads the change and drafts review comments for you,
            and because it recorded the whole session it can say things a plain diff can't: a test
            never ran, an instruction was ignored, an edit has no explanation.
          </p>
          <p>
            Every drafted comment must point at evidence in the session record or come with a check
            you can run — otherwise it isn't shown. Comments you accept, plus your own, are gathered
            into one instruction that you edit and send; the same session picks it up and continues
            in the same working copy.
          </p>
        </CopyBlock>
      </Cell>

      {/* the change page */}
      <Cell className="flex min-h-0 flex-col p-5 max-lg:hidden lg:col-span-6 lg:row-span-2">
        {/* header */}
        <div className="flex shrink-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-sans text-[13px] font-medium text-foreground">
              session 01j9y2kqv3n8tqfwd6h2r8pzae
            </p>
            <p className="truncate font-mono text-[10px] text-faint">
              worktree vs 4f2c91a3b0d7 · 6 files · +183 −75 · {openCount} open comment
              {openCount === 1 ? "" : "s"} · session
            </p>
          </div>
          <button
            type="button"
            disabled={openCount === 0 || delivered}
            onClick={() => setDialog(true)}
            className="shrink-0 cursor-pointer rounded-lg bg-primary px-3 py-1.5 font-sans text-[11.5px] font-medium text-primary-foreground shadow-[var(--shadow-cobalt)] disabled:cursor-default disabled:opacity-40"
          >
            Send review to session
          </button>
        </div>

        {/* tour bar */}
        <div className="mt-2.5 flex shrink-0 items-center gap-2">
          <span className="font-mono text-[10px] text-faint">
            Tour · stop {stop + 1} of {STOPS.length}
          </span>
          <div className="flex flex-1 gap-1">
            {STOPS.map((entry, i) => (
              <button
                key={entry.file + entry.title}
                type="button"
                aria-label={`Stop ${i + 1} — ${entry.title}`}
                onClick={() => setStop(i)}
                className={`h-1.5 flex-1 cursor-pointer rounded-full transition-colors ${
                  i < stop
                    ? "bg-[color-mix(in_oklab,var(--sw-accent)_38%,transparent)]"
                    : i === stop
                      ? "bg-primary"
                      : "bg-[var(--sw-sunken)] hover:bg-[var(--sw-rule)]"
                }`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => setStop((v) => Math.max(0, v - 1))}
            disabled={stop === 0}
            className="cursor-pointer rounded border border-border bg-panel px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground disabled:opacity-40"
          >
            k ↑
          </button>
          <button
            type="button"
            onClick={() => setStop((v) => Math.min(STOPS.length - 1, v + 1))}
            disabled={stop === STOPS.length - 1}
            className="cursor-pointer rounded border border-[color-mix(in_oklab,var(--sw-accent)_45%,transparent)] bg-panel px-1.5 py-0.5 font-mono text-[10px] text-foreground disabled:opacity-40"
          >
            j ↓
          </button>
        </div>

        <div className="mt-3 grid min-h-0 flex-1 gap-4 lg:grid-cols-[9.5rem_minmax(0,1fr)]">
          {/* files rail */}
          <div className="min-w-0 overflow-hidden">
            <p className="text-[10px] font-medium text-label">Files</p>
            <div className="mt-1.5 space-y-1">
              {FILES.map(([path, stat]) => {
                const active = current?.file === path;
                return (
                  <div
                    key={path}
                    className={`rounded-md px-1.5 py-1 ${active ? "bg-[var(--sw-wash)]" : ""}`}
                  >
                    <p className="truncate font-mono text-[9.5px] text-ink-2">{path}</p>
                    <p className="font-mono text-[9px] text-faint">{stat}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* stop content */}
          <motion.div
            key={stop}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className="flex min-h-0 flex-col gap-2.5 overflow-hidden"
          >
            <div className="shrink-0 overflow-hidden rounded-xl bg-panel shadow-[var(--shadow-sm)]">
              <p className="border-b border-[var(--sw-faint-rule)] bg-[var(--sw-sunken)] px-3 py-1 font-mono text-[10px] text-muted-foreground">
                {current?.file}
              </p>
              <div className="py-0.5 font-mono text-[10.5px] leading-[1.8]">
                {current?.lines.map(({ t, s }) => (
                  <p
                    key={s}
                    className={
                      t === "del"
                        ? "border-l-2 border-[var(--sw-del-edge)] bg-[var(--sw-del-bg)] px-3 whitespace-pre"
                        : t === "add"
                          ? "border-l-2 border-[var(--sw-add-edge)] bg-[var(--sw-add-bg)] px-3 whitespace-pre"
                          : "px-3 whitespace-pre text-faint"
                    }
                  >
                    {t === "del" ? (
                      <span className="text-danger">- </span>
                    ) : t === "add" ? (
                      <span className="text-success">+ </span>
                    ) : (
                      "  "
                    )}
                    {s}
                  </p>
                ))}
              </div>
            </div>

            {current?.disposition === "observed" ? (
              <div className="shrink-0 rounded-xl bg-panel px-3 py-2 shadow-[var(--shadow-sm)]">
                <p className="flex items-center gap-1.5 font-mono text-[9.5px] text-faint">
                  <span className="size-1.5 rounded-full bg-success-dot" aria-hidden="true" />
                  stop {stop + 1} · observed
                </p>
                <p className="mt-1 font-sans text-[11px] leading-relaxed text-foreground">
                  {current.note}
                </p>
                {current.chips.length > 0 ? (
                  <p className="mt-1 flex gap-1.5">
                    {current.chips.map((chip) => (
                      <span
                        key={chip}
                        className="rounded border border-border px-1.5 font-mono text-[9px] text-muted-foreground"
                      >
                        {chip}
                      </span>
                    ))}
                  </p>
                ) : null}
              </div>
            ) : null}

            {card !== undefined && cardIdx !== undefined && cardState !== "dismissed" ? (
              <div className="shrink-0 rounded-xl border-l-2 border-l-primary bg-panel px-3 py-2 shadow-[var(--shadow-sm)]">
                <p className="font-mono text-[9.5px] text-faint">
                  Mend · {card.anchor} ·{" "}
                  <span className={cardState === "draft" ? "text-warning" : "text-info"}>
                    {cardState === "sent" ? "sent to session" : cardState}
                  </span>
                  {card.check !== undefined && check !== "idle" ? (
                    <span className={check === "done" ? "text-success" : "text-faint"}>
                      {check === "done"
                        ? "  ✓ verified in clean workspace · exit 0 · seq 2841"
                        : "  running in a clean workspace…"}
                    </span>
                  ) : null}
                </p>
                {editing && cardIdx === 3 ? (
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={2}
                    className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1 font-sans text-[11px] leading-relaxed text-foreground"
                  />
                ) : (
                  <p className="mt-1 font-sans text-[11px] leading-relaxed text-foreground">
                    {cardIdx === 3 ? editText : card.body}
                  </p>
                )}
                {card.chips.length > 0 ? (
                  <p className="mt-1 flex flex-wrap gap-1.5">
                    {card.chips.map((chip) => (
                      <span
                        key={chip}
                        className="rounded border border-border px-1.5 font-mono text-[9px] text-muted-foreground"
                      >
                        {chip}
                      </span>
                    ))}
                  </p>
                ) : null}
                {card.check !== undefined ? (
                  <p className="mt-1 font-mono text-[9.5px] text-ink-2">{card.check}</p>
                ) : null}
                {cardState === "draft" ? (
                  <div className="mt-1.5 flex gap-1.5">
                    {card.check !== undefined && check !== "done" ? (
                      <button
                        type="button"
                        onClick={() => setCheck("running")}
                        disabled={check === "running"}
                        className="cursor-pointer rounded border border-border bg-panel px-2 py-0.5 font-sans text-[10px] font-medium text-foreground disabled:opacity-50"
                      >
                        {check === "running" ? "running…" : "Run check"}
                      </button>
                    ) : null}
                    {check === "running" && cardIdx === 1 ? (
                      <span
                        className="mend-timer"
                        style={{ "--timer": "1800ms" } as React.CSSProperties}
                        onAnimationEnd={() => setCheck("done")}
                      />
                    ) : null}
                    {check === "done" && cardIdx === 1 ? (
                      <button
                        type="button"
                        onClick={() => setCard(1, "dismissed")}
                        className="cursor-pointer rounded border border-border bg-panel px-2 py-0.5 font-sans text-[10px] font-medium text-muted-foreground"
                      >
                        Dismiss — resolved by check
                      </button>
                    ) : null}
                    {editing && cardIdx === 3 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(false);
                          setCard(3, "open");
                        }}
                        className="cursor-pointer rounded bg-primary px-2 py-0.5 font-sans text-[10px] font-medium text-primary-foreground"
                      >
                        Accept edit
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setCard(cardIdx, "open")}
                          className="cursor-pointer rounded bg-primary px-2 py-0.5 font-sans text-[10px] font-medium text-primary-foreground"
                        >
                          Accept
                        </button>
                        {cardIdx === 3 ? (
                          <button
                            type="button"
                            onClick={() => {
                              setEditing(true);
                              setEditText(
                                "lastSeenAt: nothing in the conversation explains this column — say why it exists or drop it.",
                              );
                            }}
                            className="cursor-pointer rounded border border-border bg-panel px-2 py-0.5 font-sans text-[10px] font-medium text-foreground"
                          >
                            Edit
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => setCard(cardIdx, "dismissed")}
                          className="cursor-pointer rounded border border-border bg-panel px-2 py-0.5 font-sans text-[10px] font-medium text-muted-foreground"
                        >
                          Dismiss
                        </button>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            {delivered && stop === STOPS.length - 1 ? (
              <div className="shrink-0 rounded-xl bg-[#16161a] px-3 py-2 font-mono text-[10px] leading-[1.8]">
                <p>
                  <span className="text-[#5c5c66]">$ </span>
                  <span className="text-[#e8e8ec]">mend continue</span>
                </p>
                <p className="text-[#7fbf95]">
                  ✓ follow-up for session 01j9y2kq · mend/session/01j9y2kqv3n8tqfwd6h2r8pzae
                </p>
                <p className="text-[#5c5c66]">
                  {" "}
                  instruction: │ This is a follow-up on your earlier work… │ …
                </p>
                <p className="text-[#7fbf95]">✓ delivered · session reopened</p>
                <p className="text-[#7a9ce8]">
                  {" "}
                  watch · http://localhost:3105/sessions/01j9y2kqv3n8tqfwd6h2r8pzae
                </p>
              </div>
            ) : null}
          </motion.div>
        </div>
      </Cell>

      {/* finding contract */}
      <Cell className="p-6 max-lg:hidden lg:col-span-3">
        <CellLabel>what the record adds to a diff</CellLabel>
        <div className="space-y-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
          <p>
            <span className="text-ink-2">instruction vs diff</span> — the diff contradicts the
            instruction that opened the span
          </p>
          <p>
            <span className="text-ink-2">diff vs evidence</span> — code rewritten, nothing
            exercising it ever ran
          </p>
          <p>
            <span className="text-ink-2">context vs behavior</span> — an item in the snapshot was
            never read
          </p>
          <p>
            <span className="text-ink-2">unexplained edit</span> — no prompt span or command output
            covers the write
          </p>
        </div>
        <p className="mt-3 border-t border-[var(--sw-faint-rule)] pt-2.5 font-mono text-[10px] leading-relaxed text-faint">
          "every emitted finding must either link to the record or ship with the runnable check that
          would test it. A finding that can cite neither is not emitted." · no scores, no "LGTM", no
          "safe to merge"
        </p>
      </Cell>

      {/* phone + lifecycle */}
      <Cell className="flex flex-col items-center justify-center gap-2.5 p-5 max-lg:hidden lg:col-span-3 lg:col-start-10 lg:row-start-2">
        <div className="[zoom:0.68]">
          <PhoneShell>
            <div className="shrink-0 border-b border-[var(--sw-soft-rule)] px-3.5 pb-2">
              <p className="font-mono text-[9px] text-faint">review</p>
              <p className="font-sans text-[11px] font-semibold text-foreground">The change</p>
              <p className="font-mono text-[8.5px] text-faint">6 files · +183 −75</p>
            </div>
            <div className="min-h-0 flex-1 px-3 py-2">
              <p className="truncate font-mono text-[8.5px] text-ink-2">src/auth/session.ts</p>
              <p className="mt-0.5 font-mono text-[8.5px] text-info">
                @@ -38,9 +38,9 @@ export const sessionCookie
              </p>
              <div className="mt-1 font-mono text-[8.5px] leading-[1.8]">
                <p className="text-faint"> httpOnly: true,</p>
                <p className="border-l-2 border-[var(--sw-del-edge)] bg-[var(--sw-del-bg)] pl-1">
                  - maxAge: 604800,
                </p>
                <p className="border-l-2 border-[var(--sw-add-edge)] bg-[var(--sw-add-bg)] pl-1">
                  + maxAge: 86400,
                </p>
                <p className="text-faint"> sameSite: "lax",</p>
              </div>
              <p className="mt-2 truncate font-mono text-[8.5px] text-ink-2">
                src/auth/validate.ts
              </p>
              <p className="mt-0.5 font-mono text-[8.5px] text-info">
                @@ -12,8 +12,11 @@ validateSession
              </p>
              <div className="mt-1 font-mono text-[8.5px] leading-[1.8]">
                <p className="border-l-2 border-[var(--sw-del-edge)] bg-[var(--sw-del-bg)] pl-1">
                  - const claims = decodeJwt(token)
                </p>
                <p className="border-l-2 border-[var(--sw-add-edge)] bg-[var(--sw-add-bg)] pl-1">
                  + const row = await db.sessions…
                </p>
              </div>
            </div>
            <PhoneTabs active="now" />
          </PhoneShell>
        </div>
        <div className="max-w-[17rem] space-y-2">
          <p className="font-mono text-[9.5px] leading-relaxed text-faint">
            the agent's uncommitted diff, parsed and rendered natively — commenting stays on the
            laptop
          </p>
          <p className="border-t border-[var(--sw-faint-rule)] pt-2 font-mono text-[9.5px] leading-relaxed text-faint">
            states: draft → open → addressed | dismissed — "addressed" is observed from the diff,
            not declared
          </p>
        </div>
      </Cell>

      <FactsBar
        items={[
          "dispositions: observed / never ran / unexplained — draft comments and proposed checks, never verdicts",
          "no record link and no runnable check ⇒ the finding is not emitted",
          "checkpoint = (refs/mend/checkpoints/<sessionId>/<n>, seq) · slice = refA..refB + seqA..seqB",
          'mend continue → "✓ delivered · session reopened" — the instruction is the same session\'s opening prompt',
        ]}
      />

      {/* send dialog */}
      {dialog ? (
        <div className="absolute inset-0 z-20 grid place-items-center bg-[color-mix(in_oklab,var(--sw-ink)_24%,transparent)] p-8">
          <div className="w-full max-w-[34rem] rounded-2xl bg-panel p-5 shadow-[var(--shadow-overlay)]">
            <p className="font-sans text-[14px] font-semibold text-foreground">
              Send review to the session
            </p>
            <p className="mt-0.5 font-mono text-[10px] text-faint">
              assembled from {points.length} comments · resumes
              mend/session/01j9y2kqv3n8tqfwd6h2r8pzae
            </p>
            <p className="mt-2.5 text-[10.5px] font-medium text-label">
              Instruction — edit before sending
            </p>
            <textarea
              defaultValue={INSTRUCTION(points)}
              rows={9}
              className="mt-1 w-full rounded-lg border border-input bg-background px-2.5 py-2 font-mono text-[10px] leading-relaxed text-foreground"
            />
            <p className="mt-1 font-mono text-[9px] text-faint">
              assembled mechanically from your comments; edit freely — what you send is verbatim
              what the session receives
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDialog(false)}
                className="cursor-pointer rounded-lg border border-border bg-panel px-3 py-1.5 font-sans text-[11.5px] font-medium text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setDialog(false);
                  setDelivered(true);
                  setCards((all) => all.map((v) => (v === "open" ? "sent" : v)));
                  setStop(STOPS.length - 1);
                }}
                className="cursor-pointer rounded-lg bg-primary px-3 py-1.5 font-sans text-[11.5px] font-medium text-primary-foreground shadow-[var(--shadow-cobalt)]"
              >
                Send to session
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

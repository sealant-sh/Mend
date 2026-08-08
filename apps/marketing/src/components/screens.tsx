// The five product screens and their long-form explanations. The screens are
// drawn from apps/web's real pages (session · project · review), deliberately
// more finished than today's build — they are the design target the web app
// works back toward.

import { type ReactNode } from "react";

import { Cmd } from "#/components/content";
import { MendMark } from "#/components/logo";

// ── product-screen primitives (Evidence Review, polished) ───────────────────

/** The whole app in a browser window: chrome, the real shell header, canvas. */
export function AppFrame({ url, screen }: { url: string; screen: ReactNode }) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-rule bg-[var(--sw-bg)] shadow-[var(--shadow-xl)]">
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--sw-soft-rule)] bg-[var(--sw-sunken)] px-4 py-2">
        <span className="flex items-center gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full border border-rule" />
          <span className="size-2.5 rounded-full border border-rule" />
          <span className="size-2.5 rounded-full border border-rule" />
        </span>
        <span className="min-w-0 flex-1 truncate rounded-md bg-panel px-3 py-1 text-center font-mono text-[11px] text-muted-foreground shadow-[var(--shadow-xs)]">
          {url}
        </span>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--sw-soft-rule)] bg-[color-mix(in_oklab,var(--sw-canvas)_82%,transparent)] px-5 py-2.5">
        <span className="flex items-center gap-6">
          <span className="inline-flex items-center gap-1.5 font-display text-[15px] font-semibold tracking-[-0.01em] text-foreground">
            <MendMark className="size-4.5" aria-hidden="true" />
            Mend
          </span>
          <span className="flex items-center gap-4 font-sans text-[12.5px] font-medium">
            <span className="text-foreground">Now</span>
            <span className="text-muted-foreground">Projects</span>
            <span className="text-muted-foreground">Settings</span>
          </span>
        </span>
        <span className="font-sans text-[12.5px] font-medium text-muted-foreground">Sign out</span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-6 py-5">{screen}</div>
    </div>
  );
}

function Dot({
  tone,
  word,
  pulse,
}: {
  tone: "green" | "amber" | "accent" | "hollow" | "red";
  word: string;
  pulse?: boolean;
}) {
  const dot =
    tone === "green"
      ? "bg-success-dot"
      : tone === "amber"
        ? "bg-[var(--sw-amber)]"
        : tone === "accent"
          ? "bg-[var(--sw-accent)]"
          : tone === "red"
            ? "bg-danger-dot"
            : "border-[1.5px] border-[#b3b0a8] bg-transparent";
  const text =
    tone === "green"
      ? "text-success"
      : tone === "amber"
        ? "text-warning"
        : tone === "accent"
          ? "text-info"
          : tone === "red"
            ? "text-danger"
            : "text-ink-2";
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <span
        className={`size-1.5 rounded-full ${dot} ${pulse === true ? "mend-status-running" : ""}`}
        aria-hidden="true"
      />
      <span className={`font-sans text-[11.5px] font-medium ${text}`}>{word}</span>
    </span>
  );
}

function ScreenHead({
  eyebrow,
  title,
  status,
  meta,
  action,
}: {
  eyebrow: string;
  title: string;
  status?: ReactNode;
  meta: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div>
      <p className="ev-eyebrow">{eyebrow}</p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-3">
          <h3 className="font-display text-lg font-medium tracking-tight text-foreground">
            {title}
          </h3>
          {status}
        </span>
        {action}
      </div>
      <p className="mt-1 truncate font-mono text-[10.5px] text-faint">{meta}</p>
    </div>
  );
}

function PrimaryBtn({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-lg bg-primary px-3 py-1.5 font-sans text-[12px] font-medium text-primary-foreground shadow-[var(--shadow-cobalt)]">
      {children}
    </span>
  );
}

function OutlineBtn({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-lg border border-border bg-panel px-3 py-1.5 font-sans text-[12px] font-medium text-foreground shadow-[var(--shadow-xs)]">
      {children}
    </span>
  );
}

/** Cobalt marks selection — a checked candidate is exactly that. */
function Check({ on }: { on?: boolean | undefined }) {
  return on === true ? (
    <span
      className="flex size-3.5 shrink-0 items-center justify-center rounded-[4px] bg-primary text-[9px] font-bold text-primary-foreground"
      aria-hidden="true"
    >
      ✓
    </span>
  ) : (
    <span
      className="size-3.5 shrink-0 rounded-[4px] border border-rule bg-panel"
      aria-hidden="true"
    />
  );
}

function CandidateRow({
  on,
  label,
  kind,
  first,
}: {
  on?: boolean;
  label: string;
  kind: string;
  first?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2.5 px-3.5 py-2 ${first === true ? "" : "border-t border-[var(--sw-faint-rule)]"}`}
    >
      <Check on={on} />
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate font-sans text-[12px] font-medium ${on === true ? "text-foreground" : "text-muted-foreground"}`}
        >
          {label}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[10px] text-faint">{kind}</span>
      </span>
    </div>
  );
}

function QuietBtn({ children, active }: { children: ReactNode; active?: boolean }) {
  return (
    <span
      className={`rounded-lg border px-2.5 py-1 font-mono text-[11px] shadow-[var(--shadow-xs)] ${
        active === true
          ? "border-[color-mix(in_oklab,var(--sw-accent)_45%,transparent)] bg-panel text-foreground"
          : "border-border bg-panel text-muted-foreground"
      }`}
    >
      {children}
    </span>
  );
}

function RailCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] font-medium text-label">{label}</p>
      <div className="mt-1.5 overflow-hidden rounded-xl bg-panel shadow-[var(--shadow-sm)]">
        {children}
      </div>
    </div>
  );
}

function TermPane({
  header,
  lines,
  className = "",
}: {
  header: ReactNode;
  lines: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex min-h-0 flex-col overflow-hidden rounded-xl bg-panel shadow-[var(--shadow-sm)] ${className}`}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--sw-faint-rule)] bg-[var(--sw-sunken)] px-3.5 py-1.5">
        {header}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden bg-[#16161a] px-3.5 py-2.5 font-mono text-[11.5px] leading-[1.95]">
        {lines}
      </div>
    </div>
  );
}

function TLine({
  tone = "out",
  children,
}: {
  tone?: "cmd" | "out" | "dim" | "ok";
  children?: ReactNode;
}) {
  if (tone === "cmd") {
    return (
      <span className="block whitespace-pre">
        <span className="text-[#5c5c66] select-none">$ </span>
        <span className="text-[#e8e8ec]">{children}</span>
      </span>
    );
  }
  const color =
    tone === "dim" ? "text-[#5c5c66]" : tone === "ok" ? "text-[#7fbf95]" : "text-[#b9b9c0]";
  return <span className={`block whitespace-pre ${color}`}>{children}</span>;
}

function ListRow({
  primary,
  secondary,
  right,
  first,
}: {
  primary: ReactNode;
  secondary: ReactNode;
  right: ReactNode;
  first?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 px-4 py-2.5 ${first === true ? "" : "border-t border-[var(--sw-faint-rule)]"}`}
    >
      <span className="min-w-0">
        <span className="block truncate font-sans text-[12.5px] font-medium text-foreground">
          {primary}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[10.5px] text-faint">
          {secondary}
        </span>
      </span>
      {right}
    </div>
  );
}

function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="w-[10.5rem] rotate-2 rounded-[1.5rem] border border-rule bg-panel p-1.5 shadow-[var(--shadow-xl)]">
      <div className="mx-auto mb-1 h-1 w-8 rounded-full bg-[var(--sw-rule)]" aria-hidden="true" />
      <div className="overflow-hidden rounded-[1.05rem] bg-[#16161a] px-3 py-2.5 font-mono text-[0.62rem] leading-[1.9]">
        {children}
      </div>
    </div>
  );
}

// ── the five product screens ────────────────────────────────────────────────

export const SCREENS: ReadonlyArray<{ url: string; node: ReactNode }> = [
  {
    // 01 — the session page, terminal live; a phone shows the same PTY.
    url: "mend · localhost:3101/sessions/01J8QK4M",
    node: (
      <div className="relative flex h-full flex-col gap-4">
        <ScreenHead
          eyebrow="session"
          title="claude — fix invoice rounding"
          status={<Dot tone="accent" word="Running · recording" pulse />}
          meta="mend/session/01J8QK4M · worktree store/billing-service/01J8QK4M · base 4f2c91ab90e2 · started 14:32:06"
          action={
            <span className="flex items-center gap-2">
              <PrimaryBtn>Review the change</PrimaryBtn>
              <QuietBtn>Mark checkpoint</QuietBtn>
            </span>
          }
        />
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_13rem]">
          <TermPane
            className="min-w-0"
            header={
              <>
                <span
                  className="size-1.5 animate-pulse rounded-full bg-[var(--sw-red)]"
                  aria-hidden="true"
                />
                <p className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-muted-foreground">
                  run r_01J8QK4M · live — the same session your terminal holds
                </p>
                <p className="shrink-0 font-mono text-[10.5px] text-faint">
                  attached: terminal · web · phone
                </p>
              </>
            }
            lines={
              <>
                <TLine tone="cmd">mend claude</TLine>
                <TLine>
                  session 01J8QK4M · <span className="text-[#7fbf95]">recording</span>
                </TLine>
                <TLine tone="dim"> </TLine>
                <TLine tone="dim"> [ Claude Code runs here, unchanged ]</TLine>
                <TLine tone="dim"> </TLine>
                <TLine>› round half-cents at the invoice boundary</TLine>
                <TLine tone="dim"> editing src/billing/total.ts…</TLine>
                <TLine tone="ok">✓ checkpoint 41 · seq 4021</TLine>
              </>
            }
          />
          <div className="flex min-w-0 flex-col gap-3 max-lg:hidden">
            <RailCard label="Checkpoints">
              <ListRow
                first
                primary="41 · user-mark"
                secondary="8e91c02 · seq 4021 · 14:41"
                right={<span className="font-mono text-[10.5px] text-info">diff</span>}
              />
              <ListRow
                primary="40 · auto"
                secondary="77120af · seq 3960 · 14:39"
                right={<span className="font-mono text-[10.5px] text-info">diff</span>}
              />
            </RailCard>
            <RailCard label="Forwards">
              <ListRow
                first
                primary=":3000 vite dev"
                secondary="/s/01j8qk4m/3000"
                right={<Dot tone="green" word="forwarded" />}
              />
            </RailCard>
          </div>
        </div>
        {/* Over the terminal's corner, not the rail — the phone shows the
            same screen, so it reads best sitting on it. */}
        <div className="absolute right-[13.75rem] -bottom-2 max-xl:right-4">
          <PhoneFrame>
            <TLine tone="cmd">mend claude</TLine>
            <TLine>
              01J8QK4M · <span className="text-[#7fbf95]">recording</span>
            </TLine>
            <TLine tone="dim">[ the same screen ]</TLine>
          </PhoneFrame>
        </div>
      </div>
    ),
  },
  {
    // 02 — the settled session: resume with any harness, record replayed.
    url: "mend · localhost:3101/sessions/01J8QKPT",
    node: (
      <div className="flex h-full flex-col gap-4">
        <ScreenHead
          eyebrow="session"
          title="codex — spike usage webhooks"
          status={<Dot tone="green" word="Completed · observed" />}
          meta="mend/session/01J8QKPT · worktree store/billing-service/01J8QKPT · base 4f2c91ab90e2"
          action={
            <span className="flex items-center gap-2">
              <span className="font-sans text-[11px] text-label">resume with:</span>
              <QuietBtn active>codex</QuietBtn>
              <QuietBtn>claude</QuietBtn>
              <QuietBtn>opencode</QuietBtn>
            </span>
          }
        />
        <TermPane
          className="min-h-0 flex-1"
          header={
            <p className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-muted-foreground">
              record r_01J8QKPT · settled — replay from any checkpoint
            </p>
          }
          lines={
            <>
              <TLine tone="cmd">mend codex</TLine>
              <TLine tone="dim"> [ Codex worked here — 41 checkpoints ]</TLine>
              <TLine tone="dim">detached — the session kept running</TLine>
              <TLine tone="dim"> </TLine>
              <TLine tone="cmd">mend claude --continue 01j8qkpt</TLine>
              <TLine tone="dim"> replaying scrollback…</TLine>
              <TLine>
                <span className="text-[#e8e8ec]">same worktree, same record</span> — Claude picks up
                where Codex stopped
              </TLine>
              <TLine tone="ok">✓ context snapshot 7 · unchanged across harnesses</TLine>
            </>
          }
        />
      </div>
    ),
  },
  {
    // 03 — the project page: the fleet, and every address it answers on.
    url: "mend · localhost:3101/projects/billing-service",
    node: (
      <div className="flex h-full flex-col gap-4">
        <ScreenHead
          eyebrow="project"
          title="billing-service"
          meta="store ~/.mend/store/billing-service · main@4f2c91a · origin github.com/acme/billing-service"
          action={
            <span className="flex items-center gap-2">
              <span className="font-sans text-[11px] text-label">start a session:</span>
              <QuietBtn>claude</QuietBtn>
              <QuietBtn>codex</QuietBtn>
              <QuietBtn>opencode</QuietBtn>
            </span>
          }
        />
        <div className="grid min-h-0 flex-1 content-start gap-4 lg:grid-cols-[minmax(0,1fr)_15rem]">
          <RailCard label="Sessions — one worktree each">
            <ListRow
              first
              primary="claude — fix invoice rounding"
              secondary="mend/session/01J8QK4M · base 4f2c91ab90e2"
              right={<Dot tone="accent" word="Running · recording" pulse />}
            />
            <ListRow
              primary="codex — spike usage webhooks"
              secondary="mend/session/01J8QKPT · base 4f2c91ab90e2"
              right={<Dot tone="amber" word="Waiting for input" />}
            />
            <ListRow
              primary="claude — refactor tax rules"
              secondary="mend/session/01J8QH2W · base 4f2c91ab90e2"
              right={<Dot tone="green" word="Completed · observed" />}
            />
          </RailCard>
          <div className="flex min-w-0 flex-col gap-3 max-lg:hidden">
            <RailCard label="Addresses">
              <ListRow
                first
                primary="/s/01j8qk4m"
                secondary=":3000 vite dev"
                right={<Dot tone="green" word="forwarded" />}
              />
              <ListRow
                primary="/s/01j8qkpt"
                secondary=":6006 storybook"
                right={<Dot tone="green" word="forwarded" />}
              />
            </RailCard>
            <RailCard label="References">
              <ListRow
                first
                primary="effect"
                secondary="/workspace/ref/effect · a91c2ff"
                right={<span className="font-mono text-[10.5px] text-faint">read-only</span>}
              />
            </RailCard>
          </div>
        </div>
      </div>
    ),
  },
  {
    // 04 — the review, mid-tour: a stepper walks the change in the order the
    // record wrote it; every stop is a diff plus the reason it matters.
    url: "mend · localhost:3101/changes/01J8QK4M",
    node: (
      <div className="flex h-full flex-col gap-3">
        <ScreenHead
          eyebrow="review"
          title="session invoice-rounding"
          meta="worktree vs 4f2c91ab90e2 · 8 files · +214 −87 · 2 open comments · session"
          action={
            <span className="flex items-center gap-2">
              <OutlineBtn>Exit tour</OutlineBtn>
              <PrimaryBtn>Send review to session</PrimaryBtn>
            </span>
          }
        />

        {/* The tour bar: seven stops, walked in record order. */}
        <div className="shrink-0 rounded-xl bg-panel px-3.5 py-2.5 shadow-[var(--shadow-sm)]">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate font-sans text-[12px] font-medium text-foreground">
              Stop 2 · the rounding boundary
              <span className="ml-2 font-mono text-[10.5px] font-normal text-faint">
                src/billing/total.ts · written at seq 3984
              </span>
            </p>
            <span className="flex shrink-0 items-center gap-2">
              <span className="font-mono text-[10.5px] text-faint">2 / 7</span>
              <QuietBtn>← prev</QuietBtn>
              <QuietBtn active>next →</QuietBtn>
            </span>
          </div>
          <div className="mt-2 flex gap-1" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5, 6].map((step) => (
              <span
                key={step}
                className={`h-1 flex-1 rounded-full ${
                  step < 1
                    ? "bg-[color-mix(in_oklab,var(--sw-accent)_38%,transparent)]"
                    : step === 1
                      ? "bg-primary"
                      : "bg-[var(--sw-sunken)]"
                }`}
              />
            ))}
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[10.5rem_minmax(0,1fr)]">
          <div className="min-w-0 max-lg:hidden">
            <p className="text-[10.5px] font-medium text-label">Files</p>
            <div className="mt-1.5 flex flex-col gap-1">
              {[
                ["src/billing/round.ts", "+20 −0", false, "1"],
                ["src/billing/total.ts", "+12 −4", true, "2"],
                ["src/billing/invoice.ts", "+41 −18", false, "3"],
                ["migrations/012_cents.sql", "+26 −52", false, "4"],
                ["src/api/billing.http.ts", "+9 −2", false, "5"],
                ["test/rounding.test.ts", "+36 −0", false, "6"],
                ["test/billing.test.ts", "+48 −8", false, "7"],
                ["docs/billing.md", "+22 −3", false, ""],
              ].map(([path, stat, active, stop]) => (
                <span
                  key={String(path)}
                  className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 ${active === true ? "bg-[var(--sw-wash)]" : ""}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-[10.5px] text-ink-2">
                      {path}
                    </span>
                    <span className="block font-mono text-[10px] text-faint">{stat}</span>
                  </span>
                  {stop === "" ? null : (
                    <span
                      className={`font-mono text-[10px] ${active === true ? "text-info" : "text-faint"}`}
                    >
                      {stop}
                    </span>
                  )}
                </span>
              ))}
            </div>
          </div>
          <div className="flex min-h-0 min-w-0 flex-col gap-2.5 overflow-hidden">
            <div className="shrink-0 overflow-hidden rounded-xl bg-panel shadow-[var(--shadow-sm)]">
              <p className="border-b border-[var(--sw-faint-rule)] bg-[var(--sw-sunken)] px-3.5 py-1.5 font-mono text-[10.5px] text-muted-foreground">
                src/billing/total.ts <span className="text-faint">· +12 −4</span>
              </p>
              <div className="px-0 py-1 font-mono text-[11.5px] leading-[1.8]">
                <p className="px-3.5 whitespace-pre text-faint">
                  {"  "}const rate = plan.rateFor(usage)
                </p>
                <p className="border-l-2 border-[var(--sw-del-edge)] bg-[var(--sw-del-bg)] px-3.5 whitespace-pre">
                  <span className="text-danger">-</span> const total = amount * rate
                </p>
                <p className="border-l-2 border-[var(--sw-add-edge)] bg-[var(--sw-add-bg)] px-3.5 whitespace-pre">
                  <span className="text-success">+</span> const total = round(amount * rate)
                </p>
                <p className="px-3.5 whitespace-pre text-faint">
                  {"  "}return {"{"} total, rate {"}"}
                </p>
              </div>
            </div>
            <div className="shrink-0 rounded-xl border-l-2 border-l-primary bg-panel px-3.5 py-2.5 shadow-[var(--shadow-sm)]">
              <p className="font-sans text-[12px] leading-relaxed text-foreground">
                Every amount leaves through total() — rounding here is what makes the cents
                migration in stop 4 safe. round() itself was stop 1.
              </p>
              <p className="mt-1 font-mono text-[10.5px] text-faint">
                the tour's note for this stop · from the record, seq 3960–4021
              </p>
            </div>
            <div className="shrink-0 rounded-xl border-l-2 border-l-[var(--sw-amber)] bg-panel px-3.5 py-2.5 shadow-[var(--shadow-sm)]">
              <p className="font-sans text-[12px] leading-relaxed text-foreground">
                half-cents are dropped here — intended? The record shows no test touching rounding.
              </p>
              <p className="mt-1 font-mono text-[10.5px] text-faint">
                your comment, anchored total.ts:12 · evidence seq 3984 ·{" "}
                <span className="text-info">open</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    ),
  },
  {
    // 05 — the context store: scrub the record, promote a span into a pack.
    url: "mend · localhost:3101/projects/billing-service/context",
    node: (
      <div className="flex h-full flex-col gap-4">
        <ScreenHead
          eyebrow="context"
          title="authentication-service"
          status={<Dot tone="hollow" word="pack · v3" />}
          meta="project billing-service · 4 items · snapshot 7 in use by 01J8QKPT"
          action={<PrimaryBtn>Inject into session</PrimaryBtn>}
        />
        <div className="min-w-0">
          <p className="text-[10.5px] font-medium text-label">
            Record · 01J8QK4M — drag a span, promote what mattered
          </p>
          <div className="mt-1.5 rounded-xl bg-panel px-3.5 py-3 shadow-[var(--shadow-sm)]">
            <div className="relative h-2 rounded-full bg-[var(--sw-sunken)]">
              <span
                className="absolute inset-y-0 left-[58%] w-[27%] rounded-full bg-[color-mix(in_oklab,var(--sw-accent)_30%,transparent)]"
                aria-hidden="true"
              />
              <span
                className="absolute top-1/2 left-[85%] size-3 -translate-y-1/2 rounded-full border-2 border-[var(--sw-accent)] bg-panel shadow-[var(--shadow-xs)]"
                aria-hidden="true"
              />
            </div>
            <div className="mt-2 flex items-center justify-between font-mono text-[10.5px] text-faint">
              <span>seq 0</span>
              <span className="text-info">selected seq 3960 – 4021 · “legacy callback dig”</span>
              <span>seq 4021</span>
            </div>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 content-start gap-4 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
          <RailCard label="From the selection — choose the grain">
            <CandidateRow
              first
              on
              label="decision: db sessions stay authoritative"
              kind="one answer · seq 3990"
            />
            <CandidateRow
              on
              label="check: pnpm test auth/callbacks — passing"
              kind="command + result · seq 4014"
            />
            <CandidateRow
              on
              label="handoff: legacy callback investigation"
              kind="the whole span, summarised · seq 3960–4021"
            />
            <CandidateRow
              label='exchange: "why do callbacks retry twice?"'
              kind="prompt + answer · seq 3984"
            />
            <CandidateRow
              label="file read: docs/legacy-sso.md"
              kind="as the agent saw it · seq 3971"
            />
          </RailCard>
          <div className="min-w-0 max-lg:hidden">
            <RailCard label="Pack · authentication-service">
              <ListRow
                first
                primary="AGENTS.md"
                secondary="file · pinned to main"
                right={<span className="font-mono text-[10.5px] text-faint">v3</span>}
              />
              <ListRow
                primary="docs/authentication.md"
                secondary="file · pinned to main"
                right={<span className="font-mono text-[10.5px] text-faint">v3</span>}
              />
              <ListRow
                primary="3 selections join on save"
                secondary="decision · check · handoff"
                right={<Dot tone="green" word="promoting" />}
              />
            </RailCard>
          </div>
        </div>
      </div>
    ),
  },
];

// The full story per capability — the card copy states it, this explains it.
export const EXPLAIN: ReadonlyArray<ReactNode> = [
  <>
    The session page is the same PTY your terminal holds — not a transcript of it. The web pane and
    the phone attach to the record stream, replay the scrollback, then ride the live bytes; a
    keystroke from any screen lands in the same harness. The rail keeps the machine facts beside the
    screen: checkpoints as you work, and every port the agent opens, forwarded under the session's
    address.
  </>,
  <>
    When a session settles, the page offers the continuation directly: <Cmd>resume with</Cmd> any
    harness, not just the one that started it. The next harness lands in the same worktree with the
    same context snapshot, and the record continues as one history — so the review later reads one
    change, no matter how many tools touched it.
  </>,
  <>
    The project page is the fleet view. Adoption moved the repository into the central store, so
    each session row is its own worktree checked out from that store — parallel work that never
    collides, on a machine that keeps all of it. The addresses rail answers "where is it running":
    every forwarded port, one click from any device.
  </>,
  <>
    The diff is the primary surface — read it file by file, or take the tour: the change replayed
    stop by stop, in the order the record wrote it. Comments anchor to a line and carry their
    evidence — a record sequence you can open, or a check you can run. Open comments assemble into
    one follow-up instruction that you edit before it is sent; nothing leaves the page on its own.
    Send it, and it lands in the live session for the agent to act on.
  </>,
  <>
    The context page turns sessions into reusable knowledge, at whatever grain holds up. Scrub the
    record, select a span, and Mend offers what it contained: a single decision, one prompt-and-
    answer exchange, a check that passed, a file exactly as the agent saw it — or the whole span
    summarised as a handoff. You tick what becomes context; it joins a named, versioned pack. A
    session records the exact snapshot it received, so a review can always show what the agent knew.
    Inject a pack when a session starts, or into one already running.
  </>,
];

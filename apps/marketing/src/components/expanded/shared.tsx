// Shared machinery for the five expanded tabs: the hairline-grid cells, the
// scripted terminal player, and the small chrome pieces the briefs reuse.
// The player is a state machine advanced exclusively by CSS animationend —
// typing, reveals, spinners, and holds are all animations, never timers.

import { type CSSProperties, type ReactNode, useState } from "react";

// ── grid cells ──────────────────────────────────────────────────────────────

export function Cell({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`min-w-0 overflow-hidden bg-[var(--sw-bg)] ${className}`}>{children}</div>;
}

export function CellLabel({ children }: { children: ReactNode }) {
  return <p className="ev-eyebrow mb-2.5">{children}</p>;
}

export function CopyBlock({
  index,
  title,
  children,
}: {
  index: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="max-w-[32rem]">
      <p className="font-mono text-xs text-faint">0{index + 1} / 05 · esc to close</p>
      <h2 className="mt-2.5 font-display text-[1.65rem] leading-[1.12] font-semibold tracking-[-0.02em] text-balance text-foreground">
        {title}
      </h2>
      <div className="mt-3.5 space-y-3 text-[13px] leading-relaxed text-muted-foreground [&_code]:font-mono [&_code]:text-[0.94em] [&_code]:text-ink-2">
        {children}
      </div>
    </div>
  );
}

export function FactsBar({ items }: { items: ReadonlyArray<string> }) {
  return (
    <div className="flex min-w-0 items-stretch gap-px overflow-x-auto bg-[var(--sw-soft-rule)] lg:col-span-full">
      {items.map((fact) => (
        <div
          key={fact}
          className="flex min-w-0 flex-1 items-center bg-[var(--sw-bg)] px-4 py-3 font-mono text-[10.5px] leading-snug text-faint [overflow-wrap:anywhere]"
        >
          {fact}
        </div>
      ))}
    </div>
  );
}

// ── terminal script model ───────────────────────────────────────────────────

/** One colored span of a terminal line. */
export interface Seg {
  readonly t: string;
  readonly c?: "green" | "dim" | "cobalt" | "amber" | "bright" | "out";
}

export type Step =
  /** A typed command; `prompt` defaults to "$ ". `tui` types into the TUI input. */
  | {
      readonly kind: "cmd";
      readonly text: string;
      readonly prompt?: string;
      readonly tui?: boolean;
      readonly ticker?: string;
    }
  /** A batch of output lines revealed together after `delay` ms. */
  | {
      readonly kind: "lines";
      readonly lines: ReadonlyArray<ReadonlyArray<Seg>>;
      readonly delay?: number;
      readonly ticker?: string;
    }
  /** A braille spinner + counting seconds; resolves into `resolve` lines. */
  | {
      readonly kind: "spinner";
      readonly label: string;
      readonly secs: number;
      readonly resolve: ReadonlyArray<ReadonlyArray<Seg>>;
      readonly ticker?: string;
    }
  /** Switch the pane to a raw TUI surface (or back to shell scrollback). */
  | { readonly kind: "raw"; readonly tui: TuiConfig | null; readonly ticker?: string }
  /** A keypress chip (e.g. Ctrl+]) flashed in the chrome, then its lines. */
  | {
      readonly kind: "key";
      readonly chip: string;
      readonly lines: ReadonlyArray<ReadonlyArray<Seg>>;
      readonly ticker?: string;
    }
  /** Silent hold. */
  | { readonly kind: "pause"; readonly ms: number; readonly ticker?: string }
  /** Chapter mark for tick navigation. */
  | { readonly kind: "chapter"; readonly label: string };

export interface TuiConfig {
  readonly name: string;
  readonly banner: ReadonlyArray<string>;
}

const SEG_COLOR: Record<NonNullable<Seg["c"]> | "default", string> = {
  green: "text-[#7fbf95]",
  dim: "text-[#5c5c66]",
  cobalt: "text-[#7a9ce8]",
  amber: "text-[#cfa14a]",
  bright: "text-[#e8e8ec]",
  out: "text-[#b9b9c0]",
  default: "text-[#b9b9c0]",
};

export function Line({ segs }: { segs: ReadonlyArray<Seg> }) {
  return (
    <span className="block whitespace-pre-wrap [overflow-wrap:anywhere]">
      {segs.map((seg, i) => (
        <span key={i} className={SEG_COLOR[seg.c ?? "default"]}>
          {seg.t}
        </span>
      ))}
    </span>
  );
}

// convenience seg builders — keep scripts readable
export const g = (t: string): Seg => ({ t, c: "green" });
export const d = (t: string): Seg => ({ t, c: "dim" });
export const cb = (t: string): Seg => ({ t, c: "cobalt" });
export const am = (t: string): Seg => ({ t, c: "amber" });
export const br = (t: string): Seg => ({ t, c: "bright" });
export const o = (t: string): Seg => ({ t }); // default output tone

const SPIN_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function Spinner({ label, secs, onDone }: { label: string; secs: number; onDone: () => void }) {
  return (
    <span className="block whitespace-pre-wrap text-[#5c5c66]">
      {"  "}
      <span className="inline-block h-[1.3em] overflow-hidden align-bottom">
        <span
          className="mend-strip-loop block leading-[1.3em]"
          style={
            {
              "--strip-shift": "-13em",
              "--strip-steps": 10,
              "--strip-dur": "1.2s",
            } as CSSProperties
          }
        >
          {[...SPIN_FRAMES, SPIN_FRAMES[0]].map((frame, i) => (
            <span key={i} className="block h-[1.3em]">
              {frame}
            </span>
          ))}
        </span>
      </span>{" "}
      {label}{" "}
      {secs > 1 ? (
        <span className="inline-block h-[1.3em] overflow-hidden align-bottom">
          <span
            className="mend-strip-once block leading-[1.3em]"
            style={
              {
                "--strip-shift": `${-(secs - 1) * 1.3}em`,
                "--strip-steps": secs - 1,
                "--strip-dur": `${(secs - 1) * 0.9}s`,
              } as CSSProperties
            }
            onAnimationEnd={onDone}
          >
            {Array.from({ length: secs }, (_, i) => (
              <span key={i} className="block h-[1.3em]">
                {i + 1}s
              </span>
            ))}
          </span>
        </span>
      ) : (
        <span
          className="mend-timer inline-block"
          style={{ "--timer": "700ms" } as CSSProperties}
          onAnimationEnd={onDone}
        >
          1s
        </span>
      )}
    </span>
  );
}

// ── the player ──────────────────────────────────────────────────────────────

export interface PlayerState {
  readonly idx: number;
  readonly cycle: number;
}

export function useTermPlayer(steps: ReadonlyArray<Step>, loop = true) {
  const [state, setState] = useState<PlayerState>({ idx: 0, cycle: 0 });
  const advance = () =>
    setState((s) => {
      if (s.idx + 1 < steps.length) return { idx: s.idx + 1, cycle: s.cycle };
      return loop ? { idx: 0, cycle: s.cycle + 1 } : s;
    });
  const jump = (idx: number) => setState((s) => ({ idx, cycle: s.cycle + 1 }));
  const chapters = steps
    .map((step, i) => (step.kind === "chapter" ? { label: step.label, idx: i } : null))
    .filter((x): x is { label: string; idx: number } => x !== null);
  const ticker = (() => {
    let latest: string | null = null;
    for (let i = 0; i <= state.idx && i < steps.length; i++) {
      const t = steps[i];
      if (t && "ticker" in t && t.ticker !== undefined) latest = t.ticker;
    }
    return latest;
  })();
  return { state, advance, jump, chapters, ticker };
}

/**
 * Renders steps[0..idx]. The active step animates and advances the player on
 * animationend; earlier steps render settled. A `raw` step switches the pane
 * to a TUI surface; typed commands inside it land in the TUI's input row.
 */
export function TermSurface({
  steps,
  state,
  advance,
  className = "",
}: {
  steps: ReadonlyArray<Step>;
  state: PlayerState;
  advance: () => void;
  className?: string;
}) {
  const upto = steps.slice(0, state.idx + 1);
  // active TUI = last raw step's config (null = shell)
  let tui: TuiConfig | null = null;
  let tuiStart = 0;
  upto.forEach((step, i) => {
    if (step.kind === "raw") {
      tui = step.tui;
      tuiStart = i + 1;
    }
  });
  const shellSteps = tui === null ? upto : upto.slice(0, tuiStart - 1);
  const tuiSteps = tui === null ? [] : upto.slice(tuiStart);
  const activeIndex = state.idx;

  const renderStep = (step: Step, i: number, inTui: boolean) => {
    const active = i === activeIndex;
    switch (step.kind) {
      case "chapter":
        if (active) return <AutoAdvance key={`c${i}`} ms={1} onDone={advance} />;
        return null;
      case "pause":
        return active ? <AutoAdvance key={`p${i}`} ms={step.ms} onDone={advance} /> : null;
      case "raw":
        if (active) return <AutoAdvance key={`r${i}`} ms={60} onDone={advance} />;
        return null;
      case "cmd": {
        const prompt = step.prompt ?? "$ ";
        return (
          <span key={i} className="block whitespace-pre-wrap [overflow-wrap:anywhere]">
            {!inTui && <span className="text-[#5c5c66] select-none">{prompt}</span>}
            {inTui && <span className="text-[#5c5c66] select-none">› </span>}
            {active ? (
              <>
                <span
                  className="mend-type text-[#e8e8ec]"
                  style={
                    {
                      "--type-w": `${step.text.length}ch`,
                      "--type-steps": step.text.length,
                      "--type-dur": `${step.text.length * 38}ms`,
                    } as CSSProperties
                  }
                  onAnimationEnd={advance}
                >
                  {step.text}
                </span>
                <span className="mend-caret text-[#e8e8ec]" aria-hidden="true">
                  ▍
                </span>
              </>
            ) : (
              <span className="text-[#e8e8ec]">{step.text}</span>
            )}
          </span>
        );
      }
      case "lines":
        return (
          <span
            key={i}
            className={active ? "mend-appear block" : "block"}
            style={
              active ? ({ animationDelay: `${step.delay ?? 220}ms` } as CSSProperties) : undefined
            }
            onAnimationEnd={active ? advance : undefined}
          >
            {step.lines.map((segs, j) => (
              <Line key={j} segs={segs} />
            ))}
          </span>
        );
      case "spinner":
        if (active)
          return (
            <Spinner
              key={`s${i}${state.cycle}`}
              label={step.label}
              secs={step.secs}
              onDone={advance}
            />
          );
        return (
          <span key={i} className="block">
            {step.resolve.map((segs, j) => (
              <Line key={j} segs={segs} />
            ))}
          </span>
        );
      case "key":
        return (
          <span key={i} className="block">
            <span
              className={`mr-2 inline-block rounded border border-[#3a3a42] px-1.5 font-mono text-[10px] text-[#8a8a92] ${active ? "mend-appear" : ""}`}
            >
              {step.chip}
            </span>
            <span
              className={active ? "mend-appear inline" : "inline"}
              style={active ? ({ animationDelay: "260ms" } as CSSProperties) : undefined}
              onAnimationEnd={active ? advance : undefined}
            >
              {step.lines.map((segs, j) => (
                <Line key={j} segs={segs} />
              ))}
            </span>
          </span>
        );
    }
  };

  const tuiConf = tui as TuiConfig | null;
  return (
    <div key={state.cycle} className={`font-mono text-[11.5px] leading-[1.85] ${className}`}>
      {shellSteps.map((step, i) => renderStep(step, i, false))}
      {tuiConf !== null ? (
        <div className="mend-appear mt-1.5 rounded-lg border border-[#2c2c33] p-2.5">
          <p className="text-[#8a8a92]">✻ {tuiConf.name}</p>
          {tuiConf.banner.map((line) => (
            <p key={line} className="text-[#5c5c66]">
              {line}
            </p>
          ))}
          <div className="mt-1.5 border-t border-[#2c2c33] pt-1.5">
            {tuiSteps.map((step, j) => renderStep(step, tuiStart + j, true))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Invisible timer element — advances the player after ms. */
export function AutoAdvance({ ms, onDone }: { ms: number; onDone: () => void }) {
  return (
    <span
      className="mend-timer block h-0"
      style={{ "--timer": `${Math.max(ms, 1)}ms` } as CSSProperties}
      onAnimationEnd={onDone}
      aria-hidden="true"
    />
  );
}

/** The dark terminal pane with titlebar chrome. */
export function TermFrame({
  title,
  children,
  className = "",
  footer,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
}) {
  return (
    <div
      className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-[#26262c] bg-[#16161a] shadow-[var(--shadow-lg)] ${className}`}
    >
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[#26262c] bg-[#1d1d22] px-3 py-1.5">
        <span className="size-2 rounded-full border border-[#3a3a42]" aria-hidden="true" />
        <span className="size-2 rounded-full border border-[#3a3a42]" aria-hidden="true" />
        <span className="ml-1.5 min-w-0 truncate font-mono text-[10px] text-[#5c5c66]">
          {title}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-3.5 py-2.5">{children}</div>
      {footer !== undefined ? (
        <div className="shrink-0 border-t border-[#26262c] px-3.5 py-1.5 font-mono text-[10px] text-[#5c5c66]">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

// ── the phone ───────────────────────────────────────────────────────────────
// Reference-grade hardware: near-black bezel, dynamic island with 09:41 and
// status glyphs, tall portrait screen, home indicator. Content fills the
// screen; pin bottom chrome with mt-auto.

function StatusGlyphs({ dark }: { dark: boolean }) {
  const tone = dark ? "bg-[#b9b9c0]" : "bg-[#3b3b40]";
  const line = dark ? "border-[#b9b9c0]" : "border-[#3b3b40]";
  return (
    <span className="flex items-center gap-1.5" aria-hidden="true">
      <span className="flex items-end gap-[1.5px]">
        {[3, 4.5, 6, 7.5].map((h) => (
          <span key={h} className={`w-[2px] rounded-[0.5px] ${tone}`} style={{ height: h }} />
        ))}
      </span>
      <span className={`inline-block h-[8px] w-[14px] rounded-[2.5px] border p-[1.5px] ${line}`}>
        <span className={`block h-full w-[72%] rounded-[1px] ${tone}`} />
      </span>
    </span>
  );
}

export function PhoneShell({
  children,
  dark = false,
  className = "",
}: {
  children: ReactNode;
  dark?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`w-[13.5rem] shrink-0 rounded-[2.5rem] bg-[#17171a] p-[7px] shadow-[var(--shadow-xl)] ${className}`}
    >
      <div
        className={`relative flex h-[27.5rem] flex-col overflow-hidden rounded-[2rem] ${dark ? "bg-[#101013]" : "bg-[var(--sw-bg)]"}`}
      >
        <div className="relative z-10 flex shrink-0 items-center justify-between px-4 pt-2.5 pb-1.5">
          <span
            className={`font-mono text-[9.5px] font-medium ${dark ? "text-[#b9b9c0]" : "text-foreground"}`}
          >
            09:41
          </span>
          <span
            className="absolute top-2 left-1/2 h-[16px] w-[54px] -translate-x-1/2 rounded-full bg-[#0c0c0f]"
            aria-hidden="true"
          />
          <StatusGlyphs dark={dark} />
        </div>
        {children}
        <div
          className={`pointer-events-none absolute bottom-1.5 left-1/2 z-10 h-1 w-14 -translate-x-1/2 rounded-full ${dark ? "bg-[#3a3a42]" : "bg-[#1b1b1d]/70"}`}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

export function PhoneTabs({ active }: { active: "now" | "projects" | "settings" }) {
  return (
    <div className="mt-auto flex shrink-0 items-center justify-around border-t border-[var(--sw-soft-rule)] bg-[var(--sw-sunken)] px-2 pt-1.5 pb-4">
      {(["now", "projects", "settings"] as const).map((tab) => (
        <span key={tab} className="flex flex-col items-center gap-0.5">
          <span
            className={`size-1 rounded-full ${active === tab ? "bg-[var(--sw-accent)]" : "bg-[var(--sw-rule)]"}`}
            aria-hidden="true"
          />
          <span
            className={`font-sans text-[8px] font-medium ${active === tab ? "text-foreground" : "text-faint"}`}
          >
            {tab}
          </span>
        </span>
      ))}
    </div>
  );
}

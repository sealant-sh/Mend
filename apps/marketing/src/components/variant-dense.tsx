// VARIANT /2 — the same message with more furniture: a left-set hero beside a
// terminal exhibit, icon-led capability cards, and how-it-works as one raised
// panel. Content is shared with / (components/content.tsx); only the styling
// differs. The markup lives here rather than in routes/2.tsx because
// Tailwind's source scanner skips the digit-named route file, dropping every
// class that appears only there.

import { FolderGit2, Layers, MessageSquareText, MonitorSmartphone, Repeat2 } from "lucide-react";
import { type ComponentType } from "react";

import {
  FEATURES,
  HEADLINE,
  HOW_IT_WORKS,
  InstallCommand,
  PageHeader,
  SUBLINE,
  TRUST_LINE,
} from "#/components/content";

type IconType = ComponentType<{ className?: string }>;

const FEATURE_ICONS: ReadonlyArray<IconType> = [
  MonitorSmartphone,
  Repeat2,
  FolderGit2,
  MessageSquareText,
  Layers,
];

// One terminal moment: adopt on first run, then the agent, unchanged.
const TERMINAL_LINES: ReadonlyArray<readonly ["cmd" | "out" | "live" | "note", string]> = [
  ["cmd", "pwd"],
  ["out", "/home/dev/code/billing-service"],
  ["cmd", "mend codex"],
  ["out", "adopting into the store — worktree ready"],
  ["live", "session 01J8QK4M · recording"],
  ["note", "  [ Codex runs here, unchanged ]"],
];

function HeroTerminal() {
  return (
    <div className="overflow-hidden rounded-2xl border border-rule bg-panel shadow-[var(--shadow-lg)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--sw-soft-rule)] bg-[var(--sw-sunken)] px-4 py-2.5">
        <span className="flex items-center gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full border border-rule" />
          <span className="size-2.5 rounded-full border border-rule" />
          <span className="size-2.5 rounded-full border border-rule" />
        </span>
        <span className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
          <span
            className="mend-status-running size-1.5 rounded-full bg-success-dot"
            aria-hidden="true"
          />
          mend codex
        </span>
      </div>
      <div className="overflow-x-auto px-5 py-4 font-mono text-[0.78rem] leading-[1.85]">
        <pre>
          <code>
            {TERMINAL_LINES.map(([tone, text], i) => (
              <span key={i} className="block whitespace-pre">
                {tone === "cmd" ? (
                  <>
                    <span className="text-faint select-none">$ </span>
                    <span className="text-ink-2">{text}</span>
                  </>
                ) : tone === "live" ? (
                  <>
                    <span className="text-muted-foreground">
                      {text.slice(0, text.length - "recording".length)}
                    </span>
                    <span className="text-success">recording</span>
                  </>
                ) : tone === "note" ? (
                  <span className="text-faint">{text}</span>
                ) : (
                  <span className="text-muted-foreground">{text}</span>
                )}
              </span>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}

export function MarketingPageDense() {
  return (
    <main className="relative flex min-h-dvh flex-col overflow-x-clip bg-[var(--sw-canvas)]">
      <div
        className="mend-dot-grid pointer-events-none absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_at_25%_0%,black,transparent_60%)]"
        aria-hidden="true"
      />

      <PageHeader />

      <div className="relative mx-auto flex w-full max-w-[1200px] grow flex-col justify-center gap-5 px-6 py-3 sm:px-8">
        <section className="mend-rise grid items-center gap-8 lg:grid-cols-[1.05fr_minmax(0,30rem)] lg:gap-12">
          <div className="min-w-0">
            <p className="ev-eyebrow flex items-center gap-2 text-primary">
              <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
              Open-source agent workbench
            </p>
            <h1 className="mt-4 font-display text-[2.6rem] leading-[1.04] font-semibold tracking-[-0.025em] text-balance text-foreground sm:text-[2.75rem]">
              {HEADLINE}
            </h1>
            <p className="mt-4 max-w-[48ch] text-lg leading-relaxed text-muted-foreground">
              {SUBLINE}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
              <InstallCommand />
              <p className="font-mono text-xs text-faint">{TRUST_LINE}</p>
            </div>
          </div>
          <div className="min-w-0 max-lg:hidden">
            <HeroTerminal />
          </div>
        </section>

        <section aria-label="Capabilities" className="mend-rise [animation-delay:0.1s]">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:gap-4">
            {FEATURES.map(({ title, body }, i) => {
              const Icon = FEATURE_ICONS[i] ?? MonitorSmartphone;
              return (
                <li
                  key={title}
                  className="rounded-2xl bg-panel p-4 shadow-[var(--shadow-sm)] transition-[transform,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-[var(--shadow-md)]"
                >
                  <h2 className="flex items-center gap-2.5 font-sans text-sm leading-snug font-semibold text-foreground">
                    <span
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--sw-wash)] text-primary"
                      aria-hidden="true"
                    >
                      <Icon className="size-4" />
                    </span>
                    {title}
                  </h2>
                  <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-label="How it works" className="mend-rise [animation-delay:0.2s]">
          <div className="rounded-2xl bg-panel px-6 py-3.5 shadow-[var(--shadow-sm)]">
            <p className="ev-eyebrow">How it works</p>
            <div className="mt-2.5 grid gap-6 lg:grid-cols-3 lg:gap-0 lg:divide-x lg:divide-[var(--sw-soft-rule)]">
              {HOW_IT_WORKS.map(({ title, body }, i) => (
                <div key={title} className="lg:px-6 lg:first:pl-0 lg:last:pr-0">
                  <h2 className="flex items-baseline gap-2.5 font-sans text-sm font-semibold text-foreground">
                    <span className="font-mono text-xs font-normal text-faint">0{i + 1}</span>
                    {title}
                  </h2>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

// The page's entire message, shared by both stylings (/ and /2): the claim,
// the five capabilities, the three how-it-works beats, and the install line.
// Variants restyle; they never reword.

import { Check, Copy, SunMoon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { GitHubLogo } from "#/components/github";
import { MendMark } from "#/components/logo";

export const REPO_URL = "https://github.com/sealant-sh/mend";
export const PLATFORM_SITE_URL = "https://sealant.dev";
export const INSTALL_COMMAND = "curl -fsSL https://mend.sealant.dev/install.sh | sh";

export const HEADLINE = "Run your TUI agents anywhere you want";
export const SUBLINE =
  "The coding agent you already use, in a recorded worktree on your own machine — reachable from every device you own.";
export const TRUST_LINE = "Open source · Self-hosted · Linux and macOS";

export const FEATURES: ReadonlyArray<{ title: string; body: ReactNode }> = [
  {
    title: "Any TUI — terminal, browser, phone",
    body: (
      <>
        <Cmd>mend claude</Cmd>, <Cmd>mend codex</Cmd>, or any command. One session, three ways in:
        terminal, browser, phone.
      </>
    ),
  },
  {
    title: "Sessions outlive harnesses",
    body: (
      <>
        A session belongs to the project, not the tool. Continue any session with a different
        harness than the one that started it.
      </>
    ),
  },
  {
    title: "One worktree per session",
    body: (
      <>
        Each session runs in its own worktree on the server — parallel sessions, code in one place.
        And each gets its own link: a dev server started inside is one click away.
      </>
    ),
  },
  {
    title: "Review beside the change",
    body: (
      <>
        Mend reads the change and drafts a guided review — comments and suggestions with the
        evidence beside them. Replies land back in the live session.
      </>
    ),
  },
  {
    title: "Context packs from sessions",
    body: (
      <>
        Scrub a session's record and promote what mattered into the project's context store as named
        packs. Inject it anytime.
      </>
    ),
  },
];

export const HOW_IT_WORKS: ReadonlyArray<{ title: string; body: ReactNode }> = [
  {
    title: "The binary",
    body: (
      <>
        <Cmd>mend</Cmd> runs on your machine. It adopts a repo into the central store, gives each
        session its worktree, and serves the web and phone apps.
      </>
    ),
  },
  {
    title: "The containers",
    body: (
      <>
        Sessions run in containers managed by{" "}
        <a
          href={PLATFORM_SITE_URL}
          target="_blank"
          rel="noreferrer"
          className="text-foreground underline decoration-[var(--sw-rule)] underline-offset-2 transition-colors hover:decoration-current"
        >
          Sealant
        </a>
        , the platform underneath. Each container mounts the session's worktree; the harness runs
        inside, unchanged.
      </>
    ),
  },
  {
    title: "The record",
    body: (
      <>
        Every session is recorded as it runs. Web and phone attach to the same record, so scrollback
        and review follow you between devices — and any session can be replayed.
      </>
    ),
  },
];

export function Cmd({ children }: { children: ReactNode }) {
  return <code className="font-mono text-[0.92em] text-foreground">{children}</code>;
}

export function PageHeader() {
  return (
    <header className="relative">
      <div className="mx-auto flex min-h-16 w-full max-w-[1200px] items-center justify-between gap-3 px-6 sm:px-8">
        <span className="inline-flex items-baseline gap-2.5 font-display text-xl font-semibold tracking-[-0.01em] text-foreground">
          <MendMark className="size-7 self-center" aria-hidden="true" />
          Mend
          <span className="font-mono text-xs font-normal text-faint">by Sealant</span>
        </span>
        <div className="flex items-center gap-2.5">
          <ThemeSwitcher />
          <a
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-border bg-panel px-4 font-sans text-sm font-medium text-foreground no-underline shadow-[var(--shadow-xs)] transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-input hover:shadow-[var(--shadow-sm)]"
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
          >
            <GitHubLogo className="size-4" />
            GitHub
          </a>
        </div>
      </div>
    </header>
  );
}

// The install line is the whole ask — quiet light-mono, one copy affordance.
export function InstallCommand() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(INSTALL_COMMAND);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="inline-flex min-h-11 max-w-full items-center gap-3 rounded-xl border border-rule bg-[var(--sw-sunken)] py-2 pr-2 pl-4 shadow-[var(--shadow-xs)]">
      <code className="overflow-x-auto font-mono text-[0.8rem] whitespace-nowrap text-ink-2">
        <span className="text-faint select-none">$ </span>
        {INSTALL_COMMAND}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy install command"}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--sw-wash)] hover:text-primary"
      >
        {copied ? (
          <Check className="size-4 text-success" aria-hidden="true" />
        ) : (
          <Copy className="size-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

export function ThemeSwitcher() {
  return (
    <button
      type="button"
      className="inline-flex size-9 items-center justify-center rounded-xl border border-border bg-panel text-muted-foreground shadow-[var(--shadow-xs)] transition-colors duration-200 hover:border-input hover:text-foreground"
      aria-label="Toggle color theme"
      title="Toggle theme"
      onClick={() => {
        document.documentElement.classList.toggle("dark");
      }}
    >
      <SunMoon className="size-4" aria-hidden="true" />
    </button>
  );
}

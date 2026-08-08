// The expanded story per capability: what actually happens, and one concrete
// exhibit. Shared by /3 (card → dialog) and /4 (tabbed tour). Same voice as
// everything else — observable claims, no verdicts.

import { type ReactNode } from "react";

import { Cmd } from "#/components/content";

export const DETAILS: ReadonlyArray<{
  detail: ReactNode;
  exampleTitle: string;
  example: ReactNode;
}> = [
  {
    detail: (
      <>
        The harness doesn't run in your terminal — it runs in a PTY on the Mend server.{" "}
        <Cmd>mend claude</Cmd> puts your terminal in raw mode and holds one WebSocket to that PTY:
        keystrokes go up as bytes, screen bytes come back. A browser tab or your phone is just
        another socket to the same PTY, so every screen shows the same live terminal. Detach with
        Ctrl+] and the session keeps running; reattaching replays the scrollback, then goes live.
      </>
    ),
    exampleTitle: "one PTY, any socket",
    example: (
      <MonoExample>
        <MonoLine tone="cmd">mend claude</MonoLine>
        <MonoLine tone="out">
          session 01J8QK4M · <span className="text-success">recording</span>
        </MonoLine>
        <MonoLine tone="dim"> [ Claude Code runs here, unchanged ]</MonoLine>
        <MonoLine tone="dim"> </MonoLine>
        <MonoLine tone="out">detached — the session keeps running</MonoLine>
        <MonoLine tone="cmd">mend attach 01j8qk4m</MonoLine>
        <MonoLine tone="dim"> replay, then live — on any device</MonoLine>
      </MonoExample>
    ),
  },
  {
    detail: (
      <>
        A session is the worktree, the record, and the context snapshot — not a process. Close one
        harness and continue the same session with another; the next harness lands in the same
        worktree and picks up where the record left off.
      </>
    ),
    exampleTitle: "the session, not the tool",
    example: (
      <MonoExample>
        <MonoLine tone="out">session 01J8QK4M</MonoLine>
        <MonoLine tone="dim"> worktree billing-service/01J8QK4M</MonoLine>
        <MonoLine tone="dim"> started mend codex</MonoLine>
        <MonoLine tone="out">
          {" "}
          continued <span className="text-foreground">mend claude</span>
        </MonoLine>
      </MonoExample>
    ),
  },
  {
    detail: (
      <>
        Adopting a repository moves it into Mend's central store. Each session checks out its own
        worktree from that store, so parallel sessions never collide and your working copy is never
        the workbench. Each session also gets a stable page under your Mend address — ports the
        agent opens inside, a dev server or storybook, are forwarded and listed right there, one
        click from any device.
      </>
    ),
    exampleTitle: "parallel sessions, each addressable",
    example: (
      <MonoExample>
        <MonoLine tone="out">billing-service · 3 sessions</MonoLine>
        <MonoLine tone="dim">
          {" "}
          01J8QK4M fix/invoice-rounding <span className="text-success">● running</span>
        </MonoLine>
        <MonoLine tone="dim">
          {" "}
          01J8QKPT spike/usage-webhooks <span className="text-success">● running</span>
        </MonoLine>
        <MonoLine tone="dim"> 01J8QH2W refactor/tax-rules ○ idle</MonoLine>
        <MonoLine tone="dim"> </MonoLine>
        <MonoLine tone="out">01J8QK4M · /s/01j8qk4m</MonoLine>
        <MonoLine tone="out">
          {" "}
          :3000 vite dev — <span className="text-success">forwarded</span>
        </MonoLine>
      </MonoExample>
    ),
  },
  {
    detail: (
      <>
        When you're ready to look, Mend reads the accumulated change and drafts a review — comments
        and suggested edits, each linked to the record or shipped with a runnable check. It's a
        draft, not a verdict; you decide what holds. Reply on a comment and the reply lands in the
        live session for the agent to act on.
      </>
    ),
    exampleTitle: "a drafted comment, with the diff",
    example: (
      <MonoExample>
        <span className="block border-l-2 border-[var(--sw-del-edge)] bg-[var(--sw-del-bg)] pl-2 whitespace-pre">
          - const total = amount * rate
        </span>
        <span className="block border-l-2 border-[var(--sw-add-edge)] bg-[var(--sw-add-bg)] pl-2 whitespace-pre">
          + const total = round(amount * rate)
        </span>
        <MonoLine tone="dim"> </MonoLine>
        <MonoLine tone="out">half-cents are dropped here — intended?</MonoLine>
        <MonoLine tone="dim">reply → session 01J8QK4M</MonoLine>
      </MonoExample>
    ),
  },
  {
    detail: (
      <>
        Every session is raw material for the next one. Scrub through the record, pick what mattered
        — a decision, a doc, a handoff — and promote it into the project's context store, grouped
        into named packs. Inject a pack at any point: start a session with one or pull it into a
        running one. The session keeps an immutable snapshot of what it received, so the review can
        always show exactly what the agent knew.
      </>
    ),
    exampleTitle: "a pack, assembled from the record",
    example: (
      <MonoExample>
        <MonoLine tone="out">pack authentication-service</MonoLine>
        <MonoLine tone="dim"> AGENTS.md</MonoLine>
        <MonoLine tone="dim"> docs/authentication.md</MonoLine>
        <MonoLine tone="dim"> decision: db sessions stay authoritative</MonoLine>
        <MonoLine tone="out"> handoff: legacy callback investigation</MonoLine>
        <MonoLine tone="dim">
          {"   "}
          <span className="text-success">← promoted from 01J8QK4M</span>
        </MonoLine>
      </MonoExample>
    ),
  },
];

export function MonoExample({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-x-auto rounded-xl border border-rule bg-[var(--sw-sunken)] px-4 py-3.5 font-mono text-[0.75rem] leading-[1.9] ${className}`}
    >
      {children}
    </div>
  );
}

export function MonoLine({ tone, children }: { tone: "cmd" | "out" | "dim"; children: ReactNode }) {
  if (tone === "cmd") {
    return (
      <span className="block whitespace-pre">
        <span className="text-faint select-none">$ </span>
        <span className="text-ink-2">{children}</span>
      </span>
    );
  }
  return (
    <span
      className={`block whitespace-pre ${tone === "dim" ? "text-faint" : "text-muted-foreground"}`}
    >
      {children}
    </span>
  );
}

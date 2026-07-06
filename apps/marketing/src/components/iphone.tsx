// An iPhone-framed mock — a hardware bezel around an app screen built from
// the same evidence-review tokens as the rest of the page. The bezel is a
// device, so it stays near-black in both themes; everything inside the screen
// is the token system. Static and illustrative.

import { BatteryFull, Signal, Wifi } from "lucide-react";
import { type ReactNode } from "react";

function StatusBar() {
  return (
    <div className="flex items-center justify-between px-7 pt-3.5 pb-1">
      <span className="font-mono text-[0.66rem] font-medium text-ink-2">09:41</span>
      <span className="flex items-center gap-1 text-ink-2" aria-hidden="true">
        <Signal className="size-3" />
        <Wifi className="size-3" />
        <BatteryFull className="size-3.5" />
      </span>
    </div>
  );
}

export function IPhoneFrame({
  children,
  caption,
  className = "",
}: {
  children: ReactNode;
  caption?: string;
  className?: string;
}) {
  return (
    <figure className={`w-[17rem] shrink-0 ${className}`}>
      <div className="rounded-[2.8rem] bg-[#17171a] p-[0.45rem] shadow-[var(--shadow-lg)] ring-1 ring-black/25">
        <div className="relative flex min-h-[36.5rem] flex-col overflow-hidden rounded-[2.35rem] bg-[var(--sw-bg)]">
          <div
            className="absolute top-2.5 left-1/2 z-10 h-[1.25rem] w-[5.2rem] -translate-x-1/2 rounded-full bg-[#17171a]"
            aria-hidden="true"
          />
          <StatusBar />
          <div className="flex min-h-0 flex-1 flex-col [&>*]:flex-1">{children}</div>
          <div
            className="mx-auto mt-2 mb-2 h-1 w-24 shrink-0 rounded-full bg-[var(--sw-rule)]"
            aria-hidden="true"
          />
        </div>
      </div>
      {caption ? (
        <figcaption className="ev-eyebrow mt-3.5 block text-center">{caption}</figcaption>
      ) : null}
    </figure>
  );
}

// ── Small in-screen primitives shared by the app mocks ──────────────────────

export function AppHeader({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="border-b border-rule px-5 pt-2 pb-3">
      <p className="font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
        {title}
      </p>
      {meta ? <p className="mt-0.5 font-mono text-[0.64rem] text-faint">{meta}</p> : null}
    </div>
  );
}

export function AppStatus({
  word,
  dot = "bg-success-dot",
  text = "text-success",
  pulse = false,
}: {
  word: string;
  dot?: string;
  text?: string;
  pulse?: boolean;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <span
        className={`size-1.5 rounded-full ${dot} ${pulse ? "mend-status-running" : ""}`}
        aria-hidden="true"
      />
      <span className={`font-mono text-[0.62rem] ${text}`}>{word}</span>
    </span>
  );
}

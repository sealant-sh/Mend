import type { RunStatus } from "#/lib/api";

/** Dot + word, never a glowing badge (DESIGN.md §4). */
export function StatusDot({
  tone,
  word,
  pulse,
}: {
  readonly tone: "green" | "red" | "amber" | "accent" | "hollow";
  readonly word: string;
  readonly pulse?: boolean;
}) {
  const dot =
    tone === "green"
      ? "bg-success-dot"
      : tone === "red"
        ? "bg-danger-dot"
        : tone === "amber"
          ? "bg-[var(--sw-amber)]"
          : tone === "accent"
            ? "bg-[var(--sw-accent)]"
            : "border-[1.5px] border-[#b3b0a8] bg-transparent";
  const text =
    tone === "green"
      ? "text-success"
      : tone === "red"
        ? "text-danger"
        : tone === "amber"
          ? "text-warning"
          : tone === "accent"
            ? "text-info"
            : "text-ink-2";
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`size-2 shrink-0 rounded-full ${dot} ${pulse === true ? "mend-status-running" : ""}`}
        aria-hidden="true"
      />
      <span className={`font-sans text-[13px] font-medium ${text}`}>{word}</span>
    </span>
  );
}

export function RunStatusDot({ status }: { readonly status: RunStatus }) {
  switch (status) {
    case "queued":
      return <StatusDot tone="hollow" word="Queued" />;
    case "running":
      return <StatusDot tone="accent" word="Running · recording" pulse />;
    case "completed":
      return <StatusDot tone="green" word="Completed · observed" />;
    case "failed":
      return <StatusDot tone="red" word="Failed · observed" />;
    case "cancelled":
      return <StatusDot tone="hollow" word="Cancelled" />;
  }
}

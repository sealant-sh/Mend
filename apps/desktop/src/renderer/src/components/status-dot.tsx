import type { Tone } from "#/lib/words";

const DOT: Record<Tone, string> = {
  accent: "bg-[var(--sw-accent)]",
  green: "bg-success-dot",
  amber: "bg-[var(--sw-amber)]",
  red: "bg-danger-dot",
  hollow: "border-[1.5px] border-faint bg-transparent",
};

const TEXT: Record<Tone, string> = {
  accent: "text-info",
  green: "text-success",
  amber: "text-warning",
  red: "text-danger",
  hollow: "text-muted-foreground",
};

/** Dot + word, never a glowing badge (DESIGN.md §4). The word is mono: a fact. */
export function StatusDot({
  tone,
  word,
  pulse = false,
  size = 7,
  className = "",
}: {
  readonly tone: Tone;
  readonly word?: string;
  readonly pulse?: boolean;
  readonly size?: 6 | 7;
  readonly className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span
        aria-hidden="true"
        className={`shrink-0 rounded-full ${size === 6 ? "size-1.5" : "size-[7px]"} ${DOT[tone]} ${
          pulse ? "mend-status-running" : ""
        }`}
      />
      {word !== undefined && (
        <span className={`font-sans text-[12.5px] font-medium whitespace-nowrap ${TEXT[tone]}`}>
          {word}
        </span>
      )}
    </span>
  );
}

export const toneText = (tone: Tone): string => TEXT[tone];

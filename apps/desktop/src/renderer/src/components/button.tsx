import type { ButtonHTMLAttributes } from "react";

/**
 * Two weights (DESIGN.md §5): the one consequential action is filled cobalt
 * with the cobalt lift; cheaper ones are a white panel with a hairline.
 * Sentence case, rounded-xl, a hover rise.
 */
export function Button({
  variant = "outline",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: "primary" | "outline" | "ghost";
}) {
  const base =
    "no-drag inline-flex items-center justify-center rounded-xl px-4 py-[9px] font-sans text-[14px] font-medium transition-transform disabled:cursor-default disabled:opacity-50 disabled:hover:translate-y-0";
  const look =
    variant === "primary"
      ? "bg-[var(--sw-accent)] text-white shadow-[0_5px_7px_rgba(32,82,204,0.28)] hover:-translate-y-0.5"
      : variant === "outline"
        ? "border border-[var(--sw-rule)] bg-panel text-foreground shadow-xs hover:-translate-y-0.5"
        : "text-muted-foreground hover:text-foreground";
  return <button type="button" className={`${base} ${look} ${className}`} {...rest} />;
}

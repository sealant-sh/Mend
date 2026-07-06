// Shared marketing primitives, in the Evidence Review idiom shared with the
// Sealant platform site: warm canvas, one cobalt accent, quiet mono trust
// lines, light sunken code panels. The hero/feature visual is the Mend
// Exhibit (see mend-exhibit.tsx) — a reviewed change with its run as evidence.

import { motion, useReducedMotion, type Variants } from "framer-motion";
import { ArrowRight, ArrowUpRight, Check, Copy } from "lucide-react";
import { type ComponentType, type ReactNode, useState } from "react";

export const REPO_URL = "https://github.com/sealant-sh/mend";
export const PLATFORM_URL = "https://github.com/sealant-sh/sealant";
export const PLATFORM_SITE_URL = "https://sealant.dev";

export const riseParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

export const riseChild: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
};

export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.62, ease: [0.22, 1, 0.36, 1], delay }}
    >
      {children}
    </motion.div>
  );
}

export function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full max-w-[1200px] px-6 sm:px-8 ${className}`}>{children}</div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="ev-eyebrow inline-flex items-center gap-2 text-primary">
      <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
      {children}
    </span>
  );
}

export function Display({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <h2
      className={`font-display font-semibold tracking-[-0.02em] text-foreground text-balance ${className}`}
    >
      {children}
    </h2>
  );
}

export function SectionHead({
  eyebrow,
  title,
  intro,
  className = "max-w-[56ch]",
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  intro?: ReactNode;
  className?: string;
}) {
  return (
    <Reveal className={className}>
      {eyebrow}
      <Display className="mt-5 text-[2rem] leading-[1.08] sm:text-4xl lg:text-[2.85rem]">
        {title}
      </Display>
      {intro ? (
        <div className="mt-5 space-y-4 text-lg leading-relaxed text-muted-foreground">{intro}</div>
      ) : null}
    </Reveal>
  );
}

// The one filled cobalt-lift button. Default label is the adoption ask.
export function PrimaryCTA({ href = REPO_URL, children }: { href?: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="group inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-sans text-sm font-medium text-primary-foreground no-underline shadow-[var(--shadow-cobalt)] transition-[transform,box-shadow,background-color] duration-200 hover:-translate-y-0.5 hover:bg-[var(--primary-hover)]"
    >
      {children}
      <ArrowUpRight
        className="size-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
        aria-hidden="true"
      />
    </a>
  );
}

export function SecondaryCTA({
  href = REPO_URL,
  children,
  external = true,
}: {
  href?: string;
  children: ReactNode;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-panel px-5 font-sans text-sm font-medium text-foreground no-underline shadow-[var(--shadow-xs)] transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-input hover:shadow-[var(--shadow-sm)]"
    >
      {children}
      <ArrowRight className="size-4" aria-hidden="true" />
    </a>
  );
}

export const CLONE_COMMAND = "git clone https://github.com/sealant-sh/mend";

// The repo as a copyable one-liner — the whole ask, in the page's quiet
// light-mono idiom (not a dark terminal panel).
export function CloneCommand({ className = "" }: { className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(CLONE_COMMAND);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div
      className={`inline-flex min-h-11 max-w-full items-center gap-3 rounded-xl border border-rule bg-[var(--sw-sunken)] py-2 pr-2 pl-4 shadow-[var(--shadow-xs)] ${className}`}
    >
      <code className="overflow-x-auto font-mono text-[0.8rem] whitespace-nowrap text-ink-2">
        <span className="text-faint select-none">$ </span>
        {CLONE_COMMAND}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy clone command"}
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

// A quiet mono trust line.
export function TrustLine({ className = "" }: { className?: string }) {
  return (
    <p className={`font-mono text-xs text-faint ${className}`}>
      Open-source · self-hosted · built on @sealant/sdk
    </p>
  );
}

// Cobalt left-edge callout — an open statement, never a tinted alarm panel.
export function Callout({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border-l-2 border-l-primary bg-panel py-4 pr-6 pl-5 shadow-[var(--shadow-sm)] ${className}`}
    >
      <p className="leading-relaxed text-foreground">{children}</p>
    </div>
  );
}

// Honest build status — dot + word, never a glowing badge.
export function BuildingNow({
  word = "In development",
  className = "",
}: {
  word?: string;
  className?: string;
}) {
  return (
    <span className={`flex shrink-0 items-center gap-1.5 ${className}`}>
      <span className="size-1.5 rounded-full bg-warning-dot" aria-hidden="true" />
      <span className="font-mono text-xs text-warning">{word}</span>
    </span>
  );
}

export type IconType = ComponentType<{ className?: string }>;

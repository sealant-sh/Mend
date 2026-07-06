// The Run-Record panel — the signature evidence motif, shared with the Sealant
// platform site: a lifted warm panel with a recording pulse + mono id in the
// header, a dot+word status, hairline-divided mono evidence rows, an optional
// diff peek with 2px colored edge-marks, and provenance dots per event.
//
// Static-first: every record is fully legible with no JS and under reduced motion.

import { type ReactNode } from "react";

export type Provenance = "observed" | "inferred" | "unknown";
export type StatusTone = "observed" | "inferred" | "breakage" | "pending";

export interface RecordEvent {
  readonly seq: number;
  readonly offset: string; // mm:ss.mmm
  readonly name: string; // e.g. "process.exited"
  readonly detail?: string; // e.g. "14 tests passed"
  readonly provenance?: Provenance;
}

export interface DiffLine {
  readonly sign: "+" | "-" | " ";
  readonly text: string;
}

export interface RunRecordProps {
  readonly runId: string;
  readonly capture?: string;
  readonly status: { readonly word: string; readonly tone: StatusTone };
  readonly events: ReadonlyArray<RecordEvent>;
  readonly diff?: { readonly file: string; readonly lines: ReadonlyArray<DiffLine> };
  readonly footnote?: string;
  readonly variant?: "full" | "strip" | "inert";
  readonly illustrative?: boolean;
  readonly replay?: boolean;
  readonly lift?: boolean; // cobalt-lift — reserve for the hero only
  readonly className?: string;
}

const STATUS_DOT: Record<StatusTone, string> = {
  observed: "bg-[var(--sw-green-dot)]",
  inferred: "bg-[var(--sw-amber)]",
  breakage: "bg-[var(--sw-red)]",
  pending: "ring-[1.5px] ring-[#b3b0a8] bg-transparent",
};

const STATUS_TEXT: Record<StatusTone, string> = {
  observed: "text-success",
  inferred: "text-warning",
  breakage: "text-danger",
  pending: "text-muted-foreground",
};

const PROV_LABEL: Record<Provenance, string> = {
  observed: "Observed",
  inferred: "Inferred",
  unknown: "Unknown",
};

const PROV_DOT: Record<Provenance, string> = {
  observed: "bg-[var(--sw-green-dot)]",
  inferred: "bg-[var(--sw-amber)]",
  unknown: "ring-[1.5px] ring-[#b3b0a8] bg-transparent",
};

const PROV_TEXT: Record<Provenance, string> = {
  observed: "text-success",
  inferred: "text-warning",
  unknown: "text-faint",
};

function pad(seq: number): string {
  return seq.toString().padStart(4, "0");
}

// The corner seal: recording pulse + run-id + capture timestamp.
function Seal({
  runId,
  capture,
  status,
  replay,
}: {
  runId: string;
  capture?: string | undefined;
  status: RunRecordProps["status"];
  replay?: boolean | undefined;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
      <span className="flex min-w-0 items-center gap-2">
        <span
          className="mend-status-running size-2 shrink-0 rounded-full bg-primary"
          aria-hidden="true"
        />
        <span className="truncate font-mono text-xs text-ink-2">{runId}</span>
        {capture ? <span className="font-mono text-xs text-faint">· {capture}</span> : null}
      </span>
      <span className="flex shrink-0 items-center gap-3">
        <span className="flex items-center gap-1.5">
          <span className={`size-1.5 rounded-full ${STATUS_DOT[status.tone]}`} aria-hidden="true" />
          <span className={`font-mono text-xs ${STATUS_TEXT[status.tone]}`}>{status.word}</span>
        </span>
        {replay ? (
          <span className="font-mono text-xs text-primary" aria-hidden="true">
            Replay ▸
          </span>
        ) : null}
      </span>
    </div>
  );
}

function ProvenanceTag({ provenance }: { provenance: Provenance }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <span className={`size-1.5 rounded-full ${PROV_DOT[provenance]}`} aria-hidden="true" />
      <span className={`font-mono text-[0.68rem] ${PROV_TEXT[provenance]}`}>
        {PROV_LABEL[provenance]}
      </span>
    </span>
  );
}

function EvidenceRow({ event }: { event: RecordEvent }) {
  return (
    <div className="grid grid-cols-[2.6rem_1fr] gap-x-3 border-b border-rule-faint px-4 py-2 last:border-b-0">
      <span className="pt-[0.1rem] text-right font-mono text-[0.68rem] text-faint tabular-nums">
        {pad(event.seq)}
      </span>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-[0.7rem] text-faint tabular-nums">{event.offset}</span>
        <span className="font-mono text-xs text-ink-2">{event.name}</span>
        {event.detail ? (
          <span className="min-w-0 font-mono text-xs text-muted-foreground">{event.detail}</span>
        ) : null}
        <span className="ml-auto">
          {event.provenance ? <ProvenanceTag provenance={event.provenance} /> : null}
        </span>
      </div>
    </div>
  );
}

export function DiffPeek({ file, lines }: { file: string; lines: ReadonlyArray<DiffLine> }) {
  return (
    <div className="border-t border-rule">
      <div className="bg-[var(--sw-sunken)] px-4 py-1.5 font-mono text-[0.68rem] text-faint">
        {file}
      </div>
      <div className="px-4 py-2">
        {lines.map((line, i) => {
          const edge =
            line.sign === "+"
              ? "border-l-2 border-[var(--sw-add-edge)] bg-[var(--sw-add-bg)]"
              : line.sign === "-"
                ? "border-l-2 border-[var(--sw-del-edge)] bg-[var(--sw-del-bg)]"
                : "border-l-2 border-transparent";
          return (
            <pre key={i} className={`overflow-x-auto py-[0.1rem] pl-2.5 font-mono text-xs ${edge}`}>
              <code className="text-ink-2">
                <span className="select-none text-faint">{line.sign} </span>
                {line.text}
              </code>
            </pre>
          );
        })}
      </div>
    </div>
  );
}

export function RunRecord({
  runId,
  capture,
  status,
  events,
  diff,
  footnote,
  variant = "full",
  illustrative = false,
  replay = false,
  lift = false,
  className = "",
}: RunRecordProps) {
  const shadow = lift ? "shadow-[var(--shadow-cobalt)]" : "shadow-[var(--shadow-sm)]";
  return (
    <figure
      className={`min-w-0 overflow-hidden rounded-2xl border border-border bg-panel ${shadow} ${className}`}
    >
      <Seal runId={runId} capture={capture} status={status} replay={replay} />
      {variant !== "inert" && events.length > 0 ? (
        <div>
          {events.map((event) => (
            <EvidenceRow key={event.seq} event={event} />
          ))}
        </div>
      ) : null}
      {variant === "full" && diff ? <DiffPeek file={diff.file} lines={diff.lines} /> : null}
      {footnote || illustrative ? (
        <figcaption className="flex items-center justify-between gap-3 border-t border-rule px-4 py-2.5">
          {footnote ? (
            <span className="font-mono text-[0.68rem] text-faint">{footnote}</span>
          ) : (
            <span />
          )}
          {illustrative ? (
            <span className="font-mono text-[0.62rem] tracking-[0.04em] text-faint uppercase">
              Illustrative record
            </span>
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  );
}

// A real catalog reference, not a decorative label: run mnd_4c7t · 212 events
export function CatalogEyebrow({
  runId,
  events,
  className = "",
}: {
  runId: string;
  events: string;
  className?: string;
}): ReactNode {
  return (
    <span className={`ev-eyebrow inline-flex items-center gap-1.5 ${className}`}>
      <span>run {runId}</span>
      <span className="text-faint">·</span>
      <span>{events} events</span>
    </span>
  );
}

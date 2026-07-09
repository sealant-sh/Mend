// The brief — the compiled review, rendered from the living document. A
// working surface, not the marketing miniature: one reading column, zones in
// the order a reviewer decides in (what is this → what needs attention → the
// checklist → the full account → the sources), at DESIGN.md's working type
// scale. Machine facts stay mono, dispositions stay earned, gaps stay
// first-class, and every evidence pointer clicks through to the run it came
// from, labeled by which run that was.

import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import type {
  BriefDetailDto,
  BriefDocumentDto,
  DispositionDto,
  EvidencePointerDto,
  RunDto,
} from "#/lib/api";

const DISPOSITION: Record<DispositionDto, { word: string; dot: string; text: string }> = {
  "direct-evidence": {
    word: "Direct evidence",
    dot: "bg-[var(--sw-green-dot)]",
    text: "text-success",
  },
  "not-executed": { word: "Not executed", dot: "bg-[var(--sw-amber)]", text: "text-warning" },
  "unrelated-change": { word: "Unrelated change", dot: "bg-[var(--sw-red)]", text: "text-danger" },
};

/** Which run a pointer belongs to, by kind — "initial · seq 2" over a bare "seq 2". */
export type RunLabels = ReadonlyMap<string, string>;

export const runLabelsFrom = (runs: ReadonlyArray<RunDto>): RunLabels => {
  const kindCounts = new Map<string, number>();
  for (const run of runs) kindCounts.set(run.kind, (kindCounts.get(run.kind) ?? 0) + 1);
  return new Map(
    runs.map((run) => [
      run.id,
      (kindCounts.get(run.kind) ?? 0) > 1 ? `${run.kind} ${run.id.slice(0, 8)}` : run.kind,
    ]),
  );
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const shortRef = (value: string) => (UUID_RE.test(value) ? value.slice(0, 8) : value);

/**
 * Presentational paragraphing only — the compiler writes the account as one
 * block; break it at sentence boundaries (period + space + capital) into
 * readable paragraphs. The text itself is untouched.
 */
const paragraphs = (text: string): ReadonlyArray<string> => {
  const explicit = text.split(/\n{2,}/).filter((block) => block.trim() !== "");
  if (explicit.length > 1 || text.length <= 700) return explicit.length === 0 ? [text] : explicit;
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z"'`(])/);
  const blocks: Array<string> = [];
  let current = "";
  for (const sentence of sentences) {
    current = current === "" ? sentence : `${current} ${sentence}`;
    if (current.length >= 420) {
      blocks.push(current);
      current = "";
    }
  }
  if (current !== "") blocks.push(current);
  return blocks;
};

export function SectionLabel({ children }: { readonly children: ReactNode }) {
  return <p className="text-[0.78rem] font-medium text-label">{children}</p>;
}

function Dot({ tone }: { readonly tone: "green" | "amber" | "red" | "accent" | "hollow" }) {
  const fill =
    tone === "green"
      ? "bg-[var(--sw-green-dot)]"
      : tone === "amber"
        ? "bg-[var(--sw-amber)]"
        : tone === "red"
          ? "bg-[var(--sw-red)]"
          : tone === "accent"
            ? "bg-primary"
            : "border-[1.5px] border-[var(--sw-faint)] bg-transparent";
  return <span className={`size-2 shrink-0 rounded-full ${fill}`} aria-hidden="true" />;
}

/** A pointer's link back to the recording: run + sequence, excerpt on hover. */
function EvidenceLink({ pointer }: { readonly pointer: EvidencePointerDto }) {
  return (
    <Link
      to="/runs/$runId"
      params={{ runId: pointer.runId }}
      title={pointer.excerpt}
      className="font-mono text-[0.72rem] text-primary no-underline hover:underline"
    >
      seq {pointer.sequence}
    </Link>
  );
}

export function EvidenceList({
  evidence,
  runLabels,
}: {
  readonly evidence: ReadonlyArray<EvidencePointerDto>;
  readonly runLabels?: RunLabels | undefined;
}) {
  if (evidence.length === 0) return null;
  const groups = new Map<string, Array<EvidencePointerDto>>();
  for (const pointer of evidence) {
    const entries = groups.get(pointer.runId) ?? [];
    entries.push(pointer);
    groups.set(pointer.runId, entries);
  }
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-4 gap-y-1">
      {[...groups.entries()].map(([runId, pointers]) => (
        <span key={runId} className="inline-flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-[0.72rem] text-faint">
            {runLabels?.get(runId) ?? `run ${runId.slice(0, 8)}`}
          </span>
          {pointers.map((pointer) => (
            <EvidenceLink key={`${pointer.runId}:${pointer.sequence}`} pointer={pointer} />
          ))}
        </span>
      ))}
    </span>
  );
}

/** The proof legs, raw and mono — a dot per leg, observed or not. Never struck through. */
function CausalProof({ document }: { readonly document: BriefDocumentDto }) {
  const { baseFails, headPasses, revertFails } = document.causalProof;
  const legs: ReadonlyArray<readonly [string, EvidencePointerDto | null]> = [
    ["base fails", baseFails],
    ["head passes", headPasses],
    ["revert fails", revertFails],
  ];
  const observed = legs.filter(([, pointer]) => pointer !== null).length;

  return (
    <div className="shrink-0 lg:text-right">
      <SectionLabel>Causal proof</SectionLabel>
      <p className="mt-2 flex items-center gap-2 lg:justify-end">
        <Dot tone={observed === 0 ? "hollow" : "green"} />
        <span
          className={`text-[0.85rem] font-medium ${observed === 0 ? "text-ink-2" : "text-success"}`}
        >
          {observed === 0 ? "Not executed" : `${observed} of 3 legs observed`}
        </span>
      </p>
      <p className="mt-2.5 space-y-1 font-mono text-[0.75rem]">
        {legs.map(([label, pointer]) => (
          <span key={label} className="flex items-center gap-2 lg:justify-end">
            <span className={pointer === null ? "text-faint" : "text-ink-2"}>{label}</span>
            {pointer === null ? (
              <Dot tone="hollow" />
            ) : (
              <Link
                to="/runs/$runId"
                params={{ runId: pointer.runId }}
                title={pointer.excerpt}
                className="inline-flex items-center gap-2 text-success no-underline hover:underline"
              >
                seq {pointer.sequence}
                <Dot tone="green" />
              </Link>
            )}
          </span>
        ))}
      </p>
    </div>
  );
}

/** A long account narrative: collapsed to three lines until asked for. */
function AccountText({ text }: { readonly text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 550;

  if (!long) {
    return <p className="mt-2 max-w-[75ch] text-[0.9rem] leading-[1.65] text-foreground">{text}</p>;
  }
  return (
    <div className="mt-2 max-w-[75ch]">
      {open ? (
        <div className="space-y-3">
          {paragraphs(text).map((block) => (
            <p key={block.slice(0, 48)} className="text-[0.9rem] leading-[1.65] text-foreground">
              {block}
            </p>
          ))}
        </div>
      ) : (
        <p className="line-clamp-3 text-[0.9rem] leading-[1.65] text-foreground">{text}</p>
      )}
      <button
        type="button"
        className="mt-2 font-mono text-[0.75rem] text-primary hover:underline"
        onClick={() => setOpen(!open)}
      >
        {open ? "Show less" : "Show the full account"}
      </button>
    </div>
  );
}

function Attention({
  document,
  runLabels,
}: {
  readonly document: BriefDocumentDto;
  readonly runLabels?: RunLabels | undefined;
}) {
  return (
    <section className="border-t border-rule px-6 py-6 sm:px-8">
      <SectionLabel>What needs attention</SectionLabel>
      {document.attention.length === 0 ? (
        <p className="mt-3 flex items-center gap-2">
          <Dot tone="hollow" />
          <span className="text-[0.85rem] text-muted-foreground">
            No amber or red callouts in this compile.
          </span>
        </p>
      ) : (
        <div className="mt-4 space-y-5">
          {document.attention.map((callout) => {
            const d = DISPOSITION[callout.severity];
            return (
              <div
                key={callout.text}
                className={`border-l-2 pl-4 ${
                  callout.severity === "not-executed"
                    ? "border-[var(--sw-amber)]"
                    : "border-[var(--sw-red)]"
                }`}
              >
                <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className={`font-mono text-[0.72rem] ${d.text}`}>{d.word}</span>
                  <EvidenceList evidence={callout.evidence} runLabels={runLabels} />
                </p>
                <p className="mt-1.5 max-w-[75ch] text-[0.9rem] leading-[1.6] text-foreground">
                  {callout.text}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Questions({
  document,
  runLabels,
}: {
  readonly document: BriefDocumentDto;
  readonly runLabels?: RunLabels | undefined;
}) {
  return (
    <section className="border-t border-rule px-6 py-6 sm:px-8">
      <SectionLabel>Review questions</SectionLabel>
      <div className="mt-2">
        {document.questions.map((question) => {
          const d = DISPOSITION[question.disposition];
          return (
            <div
              key={question.index}
              className="grid grid-cols-[2.25rem_minmax(0,1fr)] items-baseline gap-x-2 gap-y-1.5 border-b border-rule-faint py-3.5 last:border-b-0 sm:grid-cols-[2.25rem_minmax(0,1fr)_11rem]"
            >
              <span className="font-mono text-[0.72rem] text-faint">
                {String(question.index).padStart(2, "0")}
              </span>
              <span className="max-w-[70ch] text-[0.9rem] leading-[1.5] font-medium text-foreground">
                {question.question}
              </span>
              <span className="col-start-2 flex items-center gap-2 sm:col-start-3 sm:justify-self-end">
                <Dot
                  tone={
                    question.disposition === "direct-evidence"
                      ? "green"
                      : question.disposition === "not-executed"
                        ? "amber"
                        : "red"
                  }
                />
                <span className={`font-mono text-[0.75rem] whitespace-nowrap ${d.text}`}>
                  {d.word}
                </span>
              </span>
              {question.evidence.length === 0 ? null : (
                <span className="col-start-2">
                  <EvidenceList evidence={question.evidence} runLabels={runLabels} />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Account({ document }: { readonly document: BriefDocumentDto }) {
  return (
    <section className="grid gap-x-12 gap-y-6 border-t border-rule px-6 py-6 sm:px-8">
      <div>
        <SectionLabel>What was done</SectionLabel>
        <AccountText text={document.whatWasDone} />
        <p className="mt-3 max-w-[85ch] font-mono text-[0.75rem] leading-[1.6] text-muted-foreground">
          {document.monoFacts}
        </p>
      </div>
      <div>
        <SectionLabel>Status now</SectionLabel>
        <AccountText text={document.statusNow} />
      </div>
    </section>
  );
}

const SOURCE_KIND: Record<string, string> = {
  read_issue: "Issue",
  read_change: "Change diff",
  read_recording: "Recording",
};

function EvidenceUsed({
  document,
  runLabels,
}: {
  readonly document: BriefDocumentDto;
  readonly runLabels?: RunLabels | undefined;
}) {
  return (
    <section className="border-t border-rule px-6 py-6 sm:px-8">
      <SectionLabel>Evidence used</SectionLabel>
      {document.evidenceUsed.length === 0 ? (
        <p className="mt-3 text-[0.85rem] text-muted-foreground">
          No sources beyond the recording itself.
        </p>
      ) : (
        <div className="mt-4 grid gap-x-10 gap-y-5 sm:grid-cols-2">
          {document.evidenceUsed.map((source) => {
            const [tool, ...rest] = source.source.split(" ");
            const kind = tool === undefined ? undefined : SOURCE_KIND[tool];
            const ref = rest.join(" ");
            return (
              <div key={source.source}>
                <p className="flex flex-wrap items-baseline gap-x-2.5">
                  <span className="text-[0.85rem] font-medium text-foreground">
                    {kind ?? source.source}
                  </span>
                  {kind === undefined || ref === "" ? null : (
                    <span className="font-mono text-[0.72rem] text-faint">{shortRef(ref)}</span>
                  )}
                </p>
                <p className="mt-1 max-w-[60ch] text-[0.82rem] leading-[1.55] text-muted-foreground">
                  {source.established}
                </p>
                {source.pointers.length === 0 ? null : (
                  <p className="mt-1.5">
                    <EvidenceList evidence={source.pointers} runLabels={runLabels} />
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function BriefView({
  detail,
  runs,
}: {
  readonly detail: BriefDetailDto;
  readonly runs?: ReadonlyArray<RunDto>;
}) {
  const { brief, change } = detail;
  const document = brief.document;
  const runLabels = runs === undefined ? undefined : runLabelsFrom(runs);
  const tally = {
    total: document.questions.length,
    direct: document.questions.filter((q) => q.disposition === "direct-evidence").length,
  };
  const needJudgment = tally.total - tally.direct;

  return (
    <section aria-label="The brief" className="min-w-0">
      <div className="overflow-hidden rounded-2xl border border-border bg-panel shadow-[var(--shadow-md)]">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-rule bg-[var(--sw-sunken)] px-6 py-3 sm:px-8">
          <span className="min-w-0 truncate font-mono text-[0.78rem] text-ink-2">
            {document.header.repository}
            {document.header.prRef === null ? null : (
              <>
                {" "}
                <span className="text-faint">/</span>{" "}
                <span className="text-primary">{document.header.prRef}</span>
              </>
            )}{" "}
            <span className="text-faint">· issue {shortRef(document.header.issueRef)}</span>
            {document.header.headSha === null ? null : (
              <span className="text-faint"> · {document.header.headSha.slice(0, 7)}</span>
            )}
          </span>
          <span className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1">
            {document.header.checksCount === null ? null : (
              <span className="inline-flex items-center gap-1.5 font-mono text-[0.72rem] text-muted-foreground">
                {document.header.checksCount > 0 ? <Dot tone="green" /> : null}
                Checks {document.header.checksCount}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 font-mono text-[0.72rem] text-muted-foreground">
              <Dot tone={document.header.freshness === "current" ? "accent" : "amber"} />
              Evidence {document.header.freshness}
            </span>
            <span className="font-mono text-[0.72rem] text-faint">v{brief.currentVersion}</span>
          </span>
        </div>

        <section className="flex flex-col gap-x-12 gap-y-6 px-6 py-6 sm:px-8 lg:flex-row lg:justify-between">
          <div className="min-w-0">
            <SectionLabel>The issue</SectionLabel>
            <p className="mt-2 max-w-[72ch] text-[0.9rem] leading-[1.6] text-foreground">
              {document.issueRestated}
            </p>
            {document.reproduction === null ? null : (
              <p className="mt-2 max-w-[85ch] font-mono text-[0.75rem] leading-[1.6] whitespace-pre-wrap text-muted-foreground">
                {document.reproduction}
              </p>
            )}
          </div>
          <CausalProof document={document} />
        </section>

        <Attention document={document} runLabels={runLabels} />
        <Questions document={document} runLabels={runLabels} />
        <Account document={document} />
        <EvidenceUsed document={document} runLabels={runLabels} />

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule bg-[var(--sw-sunken)] px-6 py-3.5 sm:px-8">
          <span className="font-mono text-[0.75rem] text-muted-foreground">
            {tally.total} review questions · {tally.direct} {tally.direct === 1 ? "has" : "have"}{" "}
            direct evidence · {needJudgment} need judgment
          </span>
          <span className="font-mono text-[0.72rem] text-faint">
            branch {change.branch === "" ? "(workspace)" : change.branch} · compiled{" "}
            {new Date(brief.updatedAt).toLocaleString()}
          </span>
        </div>
      </div>
    </section>
  );
}

// The brief — the compiled review, rendered from the living document. Follows
// the canonical exhibit (apps/marketing) in the evidence-review vocabulary:
// machine facts in mono, dispositions earned, gaps first-class. Every evidence
// pointer clicks through to the run it came from.

import { Link } from "@tanstack/react-router";
import { type ReactNode } from "react";

import type {
  BriefDetailDto,
  BriefDocumentDto,
  DispositionDto,
  EvidencePointerDto,
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

function SectionLabel({ children }: { readonly children: ReactNode }) {
  return <p className="text-[0.78rem] font-medium text-label">{children}</p>;
}

function HeaderChip({ children, dot }: { readonly children: ReactNode; readonly dot?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[0.68rem] text-muted-foreground">
      {dot ? <span className={`size-1.5 rounded-full ${dot}`} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/** A claim's link back to the recording: run + sequence, excerpt on hover. */
function EvidenceLink({ pointer }: { readonly pointer: EvidencePointerDto }) {
  return (
    <Link
      to="/runs/$runId"
      params={{ runId: pointer.runId }}
      title={pointer.excerpt}
      className="font-mono text-[0.66rem] text-primary no-underline hover:underline"
    >
      seq {pointer.sequence}
    </Link>
  );
}

function EvidenceList({ evidence }: { readonly evidence: ReadonlyArray<EvidencePointerDto> }) {
  if (evidence.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      {evidence.map((pointer) => (
        <EvidenceLink key={`${pointer.runId}:${pointer.sequence}`} pointer={pointer} />
      ))}
    </span>
  );
}

function CausalProof({ document }: { readonly document: BriefDocumentDto }) {
  const { baseFails, headPasses, revertFails } = document.causalProof;
  const legs: ReadonlyArray<readonly [string, EvidencePointerDto | null]> = [
    ["base fails", baseFails],
    ["head passes", headPasses],
    ["revert fails", revertFails],
  ];
  const executed = legs.filter(([, pointer]) => pointer !== null);

  return (
    <div className="shrink-0 text-right">
      {executed.length === 0 ? (
        <p className="flex items-center justify-end gap-1.5">
          <span
            className="size-1.5 rounded-full bg-transparent ring-[1.5px] ring-[#b3b0a8]"
            aria-hidden="true"
          />
          <span className="font-mono text-[0.72rem] text-muted-foreground">
            Causal proof not executed
          </span>
        </p>
      ) : (
        <p className="flex items-center justify-end gap-1.5">
          <span className="size-1.5 rounded-full bg-[var(--sw-green-dot)]" aria-hidden="true" />
          <span className="text-[0.8rem] font-medium text-success">
            {executed.length} of 3 proof legs observed
          </span>
        </p>
      )}
      <p className="mt-1 font-mono text-[0.68rem] text-faint">
        {legs.map(([label, pointer], index) => (
          <span key={label}>
            {index > 0 ? " · " : ""}
            <span className={pointer === null ? "line-through opacity-60" : ""}>{label}</span>
          </span>
        ))}
      </p>
    </div>
  );
}

function MainColumn({ document }: { readonly document: BriefDocumentDto }) {
  const footer = {
    total: document.questions.length,
    direct: document.questions.filter((q) => q.disposition === "direct-evidence").length,
  };

  return (
    <div className="min-w-0 flex-1 px-5 py-5 sm:px-7 sm:py-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <p className="min-w-0 font-mono text-[0.68rem] text-faint">
          {document.header.issueRef}
          {document.header.headSha === null ? "" : ` · ${document.header.headSha.slice(0, 7)}`}
        </p>
        <CausalProof document={document} />
      </div>

      <div className="mt-5 space-y-5 border-t border-rule pt-5">
        <div>
          <SectionLabel>The issue</SectionLabel>
          <p className="mt-1.5 max-w-[58ch] text-[0.86rem] leading-relaxed text-foreground">
            {document.issueRestated}
          </p>
          {document.reproduction === null ? null : (
            <p className="mt-1 font-mono text-[0.72rem] whitespace-pre-wrap text-muted-foreground">
              {document.reproduction}
            </p>
          )}
        </div>
        <div>
          <SectionLabel>What was done</SectionLabel>
          <p className="mt-1.5 max-w-[58ch] text-[0.86rem] leading-relaxed text-foreground">
            {document.whatWasDone}
          </p>
          <p className="mt-1 font-mono text-[0.72rem] text-muted-foreground">
            {document.monoFacts}
          </p>
        </div>
        <div>
          <SectionLabel>Status now</SectionLabel>
          <p className="mt-1.5 max-w-[58ch] text-[0.86rem] leading-relaxed text-foreground">
            {document.statusNow}
          </p>
        </div>
      </div>

      <div className="mt-6 border-t border-rule pt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <SectionLabel>Review questions</SectionLabel>
          <p className="font-mono text-[0.66rem] text-faint">
            {footer.direct} of {footer.total} directly observed
          </p>
        </div>
        <div className="mt-2.5">
          {document.questions.map((question) => {
            const d = DISPOSITION[question.disposition];
            return (
              <div
                key={question.index}
                className="border-b border-rule-faint py-2.5 last:border-b-0"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex min-w-0 items-baseline gap-3">
                    <span className="font-mono text-[0.68rem] text-faint">
                      {String(question.index).padStart(2, "0")}
                    </span>
                    <span className="text-[0.86rem] font-medium text-foreground">
                      {question.question}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className={`size-1.5 rounded-full ${d.dot}`} aria-hidden="true" />
                    <span className={`font-mono text-[0.72rem] ${d.text}`}>{d.word}</span>
                  </span>
                </div>
                {question.evidence.length === 0 ? null : (
                  <p className="mt-1 pl-[calc(0.68rem*2+0.75rem)]">
                    <EvidenceList evidence={question.evidence} />
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AttentionRail({ document }: { readonly document: BriefDocumentDto }) {
  return (
    <aside className="w-full shrink-0 border-t border-rule px-5 py-5 sm:px-6 sm:py-6 lg:w-[19rem] lg:border-t-0 lg:border-l">
      <SectionLabel>What needs attention</SectionLabel>
      {document.attention.length === 0 ? (
        <p className="mt-2.5 text-[0.82rem] leading-snug text-muted-foreground">
          No amber or red callouts in this compile.
        </p>
      ) : (
        <div className="mt-2.5 space-y-2.5">
          {document.attention.map((callout) => (
            <div
              key={callout.text}
              className={`border-l-2 pl-3 ${
                callout.severity === "not-executed"
                  ? "border-[var(--sw-amber)]"
                  : "border-[var(--sw-red)]"
              }`}
            >
              <p className="text-[0.82rem] leading-snug text-foreground">{callout.text}</p>
              <EvidenceList evidence={callout.evidence} />
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 border-t border-rule-faint pt-5">
        <SectionLabel>Evidence used</SectionLabel>
        {document.evidenceUsed.length === 0 ? (
          <p className="mt-2.5 text-[0.8rem] leading-snug text-muted-foreground">
            No sources beyond the recording itself.
          </p>
        ) : (
          <div className="mt-2.5 space-y-3">
            {document.evidenceUsed.map((source) => (
              <div key={source.source}>
                <p className="text-[0.8rem] leading-snug font-medium text-foreground">
                  {source.source}
                </p>
                <p className="mt-0.5 text-[0.74rem] leading-snug text-muted-foreground">
                  {source.established}
                </p>
                <EvidenceList evidence={source.pointers} />
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

export function BriefView({ detail }: { readonly detail: BriefDetailDto }) {
  const { brief, change } = detail;
  const document = brief.document;
  const footer = {
    total: document.questions.length,
    direct: document.questions.filter((q) => q.disposition === "direct-evidence").length,
  };
  const needJudgment = footer.total - footer.direct;

  return (
    <figure className="min-w-0">
      <div className="overflow-hidden rounded-2xl border border-border bg-panel shadow-[var(--shadow-md)]">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-rule bg-[var(--sw-sunken)] px-5 py-3 sm:px-7">
          <span className="min-w-0 truncate font-mono text-[0.72rem] text-ink-2">
            {document.header.repository}
            {document.header.prRef === null ? null : (
              <>
                {" "}
                <span className="text-faint">/</span>{" "}
                <span className="text-primary">{document.header.prRef}</span>
              </>
            )}{" "}
            <span className="text-faint">· {document.header.issueRef}</span>
          </span>
          <span className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1">
            {document.header.checksCount === null ? null : (
              <HeaderChip dot="bg-[var(--sw-green-dot)]">
                Checks {document.header.checksCount}
              </HeaderChip>
            )}
            <HeaderChip
              dot={document.header.freshness === "current" ? "bg-primary" : "bg-[var(--sw-amber)]"}
            >
              Evidence {document.header.freshness}
            </HeaderChip>
            <span className="font-mono text-[0.68rem] text-faint">v{brief.currentVersion}</span>
          </span>
        </div>

        <div className="flex flex-col lg:flex-row">
          <MainColumn document={document} />
          <AttentionRail document={document} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule px-5 py-3.5 sm:px-7">
          <span className="font-mono text-[0.7rem] text-muted-foreground">
            {footer.total} review questions · {footer.direct} have direct evidence · {needJudgment}{" "}
            need judgment
          </span>
          <span className="font-mono text-[0.68rem] text-faint">
            branch {change.branch === "" ? "(workspace)" : change.branch} · compiled{" "}
            {new Date(brief.updatedAt).toLocaleString()}
          </span>
        </div>
      </div>
    </figure>
  );
}

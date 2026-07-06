import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "#/components/shell";
import { listIssues, type IssueDto, type IssueStage } from "#/lib/api";

export const Route = createFileRoute("/")({
  // Session lives in a cookie; the loader runs in the browser and the API
  // redirects to /login via 401. No SSR for authed surfaces in M0.
  ssr: false,
  loader: () => listIssues(),
  component: QueuePage,
});

const STAGES: ReadonlyArray<{
  readonly stage: IssueStage;
  readonly title: string;
  readonly hint: string;
}> = [
  { stage: "triage", title: "Triage", hint: "Issues arrive here. Mend does nothing on its own." },
  { stage: "queued", title: "Queued", hint: "Gate 1 — a human dragged these in, in this order." },
  { stage: "mending", title: "Mending", hint: "One harness per issue, recorded." },
  { stage: "review", title: "Review", hint: "The brief is ready to read." },
  { stage: "merged", title: "Merged", hint: "Approved by a human, merged on GitHub." },
];

function QueuePage() {
  const issues = Route.useLoaderData();

  return (
    <AppShell>
      <div className="mb-8">
        <p className="ev-eyebrow">triage · queued · mending · review · merged</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.02em]">The queue</h1>
        <p className="mt-2 max-w-[64ch] text-sm leading-relaxed text-muted-foreground">
          Work starts when a person drags an issue into the queue — never before. Drag-and-drop
          lands with manual issue entry in the next milestone.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {STAGES.map(({ stage, title, hint }) => (
          <StageColumn
            key={stage}
            title={title}
            hint={hint}
            issues={issues.filter((issue) => issue.stage === stage)}
          />
        ))}
      </div>
    </AppShell>
  );
}

function StageColumn({
  title,
  hint,
  issues,
}: {
  readonly title: string;
  readonly hint: string;
  readonly issues: ReadonlyArray<IssueDto>;
}) {
  return (
    <section className="min-w-0">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="font-sans text-[13px] font-semibold">{title}</h2>
        <span className="font-mono text-xs text-faint">{issues.length}</span>
      </div>
      <div className="mt-3 space-y-3">
        {issues.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/80 px-4 py-6">
            <p className="text-[13px] leading-relaxed text-muted-foreground">{hint}</p>
          </div>
        ) : (
          issues.map((issue) => <IssueCard key={issue.id} issue={issue} />)
        )}
      </div>
    </section>
  );
}

function IssueCard({ issue }: { readonly issue: IssueDto }) {
  return (
    <article className="rounded-2xl bg-panel p-4 shadow-[var(--shadow-sm)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]">
      <h3 className="font-sans text-sm font-medium leading-snug">{issue.title}</h3>
      <p className="mt-2 truncate font-mono text-xs text-faint">
        {issue.externalRef ?? issue.repository}
      </p>
    </article>
  );
}

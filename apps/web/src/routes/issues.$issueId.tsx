import { createFileRoute, Link } from "@tanstack/react-router";

import { AppShell } from "#/components/shell";
import { RunStatusDot } from "#/components/status";
import { issueDetail, type RunDto } from "#/lib/api";

export const Route = createFileRoute("/issues/$issueId")({
  ssr: false,
  loader: ({ params }) => issueDetail(params.issueId),
  component: IssuePage,
});

function IssuePage() {
  const { issue, runs } = Route.useLoaderData();

  return (
    <AppShell>
      <div className="mb-8">
        <p className="ev-eyebrow">
          issue · {issue.source} · {issue.stage}
        </p>
        <h1 className="mt-2 max-w-[40ch] font-display text-3xl font-semibold tracking-[-0.02em]">
          {issue.title}
        </h1>
        <p className="mt-2 font-mono text-[12.5px] text-faint">
          {issue.externalRef ?? issue.repository}
        </p>
      </div>

      <div className="grid max-w-5xl gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-2xl bg-panel p-6 shadow-[var(--shadow-sm)]">
          <h2 className="font-sans text-sm font-semibold">The issue</h2>
          {issue.body === "" ? (
            <p className="mt-3 text-[13px] text-muted-foreground">No body — the title is all.</p>
          ) : (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink-2">
              {issue.body}
            </p>
          )}
        </section>

        <section className="rounded-2xl bg-panel p-6 shadow-[var(--shadow-sm)]">
          <div className="flex items-baseline justify-between">
            <h2 className="font-sans text-sm font-semibold">Runs</h2>
            <span className="font-mono text-xs text-faint">{runs.length}</span>
          </div>
          {runs.length === 0 ? (
            <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
              No runs yet. Drag the issue into the queue to start one.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-[var(--sw-faint-rule)]">
              {runs.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function RunRow({ run }: { readonly run: RunDto }) {
  return (
    <li>
      <Link
        to="/runs/$runId"
        params={{ runId: run.id }}
        className="block px-1 py-3 no-underline transition-colors duration-150 hover:bg-sunken/60"
      >
        <div className="flex items-center justify-between gap-3">
          <RunStatusDot status={run.status} />
          <span className="font-mono text-[11.5px] text-faint">{run.kind}</span>
        </div>
        {run.summary === null ? null : (
          <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
            {run.summary}
          </p>
        )}
        <p className="mt-1.5 font-mono text-[11.5px] text-faint">
          {new Date(run.createdAt).toLocaleString()}
        </p>
      </Link>
    </li>
  );
}

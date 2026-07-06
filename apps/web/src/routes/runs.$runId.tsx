import { createFileRoute, Link } from "@tanstack/react-router";

import { AppShell } from "#/components/shell";
import { RunStatusDot } from "#/components/status";
import { runDetail } from "#/lib/api";

export const Route = createFileRoute("/runs/$runId")({
  ssr: false,
  loader: ({ params }) => runDetail(params.runId),
  component: RunPage,
});

function RunPage() {
  const { run, commands, transcript, recordError } = Route.useLoaderData();

  return (
    <AppShell>
      <div className="mb-8">
        <p className="ev-eyebrow">run · {run.kind}</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.02em]">The run</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          What the recording can already show — the full run audit arrives with the brief.
        </p>
      </div>

      <div className="max-w-3xl space-y-6">
        {/* The run-record motif: lifted panel, mono facts, hairline rows. */}
        <section className="rounded-2xl bg-panel p-6 shadow-[var(--shadow-sm)]">
          <div className="flex items-center justify-between gap-4">
            <RunStatusDot status={run.status} />
            <span className="font-mono text-[11.5px] text-faint">{run.id.slice(0, 8)}</span>
          </div>
          <div className="mt-5 space-y-2.5 border-t border-[var(--sw-faint-rule)] pt-5">
            <Fact label="issue">
              <Link
                to="/issues/$issueId"
                params={{ issueId: run.issueId }}
                className="text-[var(--sw-accent)] no-underline hover:underline"
              >
                {run.issueId.slice(0, 8)}
              </Link>
            </Fact>
            <Fact label="sealant run">{run.sealantRunId ?? "never started"}</Fact>
            <Fact label="started">
              {run.startedAt === null ? "—" : new Date(run.startedAt).toLocaleString()}
            </Fact>
            <Fact label="settled">
              {run.settledAt === null ? "—" : new Date(run.settledAt).toLocaleString()}
            </Fact>
          </div>
          {run.summary === null ? null : (
            <p className="mt-5 border-t border-[var(--sw-faint-rule)] pt-5 text-sm leading-relaxed text-ink-2">
              {run.summary}
            </p>
          )}
        </section>

        {recordError === null ? null : (
          <p className="border-l-2 border-[var(--sw-amber)] pl-3 text-[13px] leading-relaxed text-warning">
            The recording could not be read: <span className="font-mono">{recordError}</span>
          </p>
        )}

        {commands.length === 0 ? null : (
          <section className="rounded-2xl bg-panel shadow-[var(--shadow-sm)]">
            <div className="border-b border-[var(--sw-soft-rule)] bg-sunken px-6 py-3 rounded-t-2xl">
              <h2 className="font-sans text-[13px] font-semibold">What the run executed</h2>
            </div>
            <ul className="divide-y divide-[var(--sw-faint-rule)] px-6">
              {commands.map((command, index) => (
                <li key={index} className="flex items-baseline justify-between gap-4 py-3">
                  <code className="min-w-0 break-all font-mono text-[12.5px] text-ink-2">
                    {command.command}
                  </code>
                  <span
                    className={`shrink-0 font-mono text-[11.5px] ${
                      command.exitCode === 0
                        ? "text-success"
                        : command.exitCode === null
                          ? "text-faint"
                          : "text-danger"
                    }`}
                  >
                    {command.exitCode === null ? "—" : `exit ${command.exitCode}`}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {transcript === null ? null : (
          <section className="rounded-2xl bg-panel shadow-[var(--shadow-sm)]">
            <div className="border-b border-[var(--sw-soft-rule)] bg-sunken px-6 py-3 rounded-t-2xl">
              <h2 className="font-sans text-[13px] font-semibold">Transcript</h2>
            </div>
            <pre className="max-h-[32rem] overflow-auto px-6 py-4 font-mono text-[12px] leading-relaxed text-ink-2">
              {transcript}
            </pre>
          </section>
        )}
      </div>
    </AppShell>
  );
}

function Fact({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-28 shrink-0 font-mono text-xs uppercase tracking-[0.06em] text-label">
        {label}
      </span>
      <span className="break-all font-mono text-[12.5px] text-ink-2">{children}</span>
    </div>
  );
}

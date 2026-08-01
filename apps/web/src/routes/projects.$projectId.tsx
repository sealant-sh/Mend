import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { AppShell } from "#/components/shell";
import { SessionStatusDot } from "#/components/status";
import {
  addProjectMount,
  addReference,
  createSession,
  launchSession,
  refreshReference,
  removeProjectMount,
  removeReference,
  selectProjectReferences,
} from "#/lib/api";
import {
  projectDetailQuery,
  projectMountsQuery,
  projectReferencesQuery,
  queryClient,
  referencesQuery,
} from "#/lib/queries";
import { useWorkbenchEvents } from "#/lib/workbench-events";

export const Route = createFileRoute("/projects/$projectId")({
  ssr: false,
  loader: async ({ params }) => {
    await Promise.all([
      queryClient.ensureQueryData(projectDetailQuery(params.projectId)),
      queryClient.ensureQueryData(referencesQuery),
      queryClient.ensureQueryData(projectReferencesQuery(params.projectId)),
      queryClient.ensureQueryData(projectMountsQuery(params.projectId)),
    ]);
  },
  component: ProjectPage,
});

/** How each harness launches — mirrors the CLI's map; the server records either way. */
const HARNESSES: ReadonlyArray<{ readonly name: string; readonly argv: ReadonlyArray<string> }> = [
  { name: "claude", argv: ["claude"] },
  { name: "codex", argv: ["codex"] },
  { name: "opencode", argv: ["opencode"] },
];

function ProjectPage() {
  const { projectId } = Route.useParams();
  const { project, sessions } = useSuspenseQuery(projectDetailQuery(projectId)).data;
  const navigate = useNavigate();
  const [starting, setStarting] = useState<string | null>(null);
  useWorkbenchEvents();

  /**
   * Fire a session from here: create the row, kick the supervised launch, and
   * go straight to the session page — its terminal pane attaches the moment
   * the workspace is ready. The launch promise outlives the navigation (same
   * SPA); a failure settles the session server-side, so the page shows it.
   */
  const start = (harness: string, argv: ReadonlyArray<string>) => {
    setStarting(harness);
    void createSession(projectId, harness)
      .then((session) => {
        void launchSession(session.id, argv)
          .catch(() => undefined)
          .finally(() => {
            void queryClient.invalidateQueries({ queryKey: ["session", session.id] });
          });
        return navigate({ to: "/sessions/$sessionId", params: { sessionId: session.id } });
      })
      .finally(() => setStarting(null));
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-[900px]">
        <p className="ev-eyebrow">project</p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-foreground">
          {project.name}
        </h1>
        <p className="mt-2 font-mono text-xs text-faint">
          store {project.storePath} · {project.defaultBranch}
          {project.adoptedSha === null ? "" : `@${project.adoptedSha.slice(0, 7)}`}
          {project.originUrl === null ? "" : ` · origin ${project.originUrl}`}
        </p>

        <section className="mt-9">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-medium text-label">Sessions</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-label">start a session:</span>
              {HARNESSES.map((harness) => (
                <button
                  key={harness.name}
                  type="button"
                  disabled={starting !== null}
                  onClick={() => start(harness.name, harness.argv)}
                  className="rounded-xl border border-border bg-card px-3 py-1.5 font-mono text-xs text-foreground shadow-xs transition-transform hover:-translate-y-0.5 disabled:opacity-50"
                >
                  {starting === harness.name ? "starting…" : harness.name}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 overflow-hidden rounded-2xl bg-card shadow-sm">
            {sessions.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">
                No sessions yet — start one above, or{" "}
                <span className="font-mono text-xs">mend claude</span> in this repository. Either
                way it runs in its own worktree, recorded.
              </p>
            ) : (
              sessions.map((session, index) => (
                <Link
                  key={session.id}
                  to="/sessions/$sessionId"
                  params={{ sessionId: session.id }}
                  className={`flex items-center justify-between gap-4 px-5 py-4 no-underline transition-colors hover:bg-secondary ${index === 0 ? "" : "border-t border-rule-faint"}`}
                >
                  <div className="min-w-0">
                    <p className="font-sans text-sm font-medium text-foreground">
                      {session.harness}
                      {session.label === null ? "" : ` — ${session.label}`}
                    </p>
                    <p className="mt-1 truncate font-mono text-xs text-faint">
                      {session.branch} · base {session.baseSha.slice(0, 12)}
                    </p>
                  </div>
                  <SessionStatusDot
                    status={session.status}
                    recorded={session.sealantRunId !== null}
                  />
                </Link>
              ))
            )}
          </div>
        </section>

        <ReferencesSection projectId={projectId} />

        <MountsSection projectId={projectId} />
      </div>
    </AppShell>
  );
}

/**
 * Per-project extra mounts (plan §17, 2026-08-01): host folders this
 * project's sessions can see at /workspace/home/<name>. Read-only by default;
 * read-write is a deliberate per-folder choice, and writes there land on the
 * host folder directly — outside the reviewed change, which stays exactly
 * worktree-versus-base.
 */
function MountsSection({ projectId }: { readonly projectId: string }) {
  const mounts = useSuspenseQuery(projectMountsQuery(projectId)).data;
  const [busy, setBusy] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["project", projectId, "mounts"] });

  const remove = (mountId: string) => {
    setBusy(mountId);
    void removeProjectMount(projectId, mountId)
      .then(invalidate)
      .finally(() => setBusy(null));
  };

  const add = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const hostPath = String(data.get("hostPath") ?? "").trim();
    const readOnly = data.get("readOnly") === "on";
    if (name === "" || hostPath === "") return;
    setBusy("add");
    setAddError(null);
    void addProjectMount(projectId, { name, hostPath, readOnly })
      .then(async () => {
        await invalidate();
        form.reset();
        return null;
      })
      .catch((error: unknown) => {
        setAddError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setBusy(null));
  };

  return (
    <section className="mt-9">
      <p className="text-xs font-medium text-label">Mounted folders</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Host folders this project's next sessions can see, at{" "}
        <span className="font-mono text-xs">/workspace/home/&lt;name&gt;</span>. Read-only unless
        deliberately chosen otherwise — the reviewed change stays the worktree.
      </p>
      <div className="mt-3 overflow-hidden rounded-2xl bg-card shadow-sm">
        {mounts.map((mount, index) => (
          <div
            key={mount.id}
            className={`flex items-center justify-between gap-4 px-5 py-4 ${index === 0 ? "" : "border-t border-rule-faint"}`}
          >
            <div className="min-w-0">
              <p className="font-sans text-sm font-medium text-foreground">
                {mount.name}
                {mount.readOnly ? null : (
                  <span className="ml-2 font-mono text-xs text-warning">read-write</span>
                )}
              </p>
              <p className="mt-1 truncate font-mono text-xs text-faint">{mount.hostPath}</p>
            </div>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => remove(mount.id)}
              className="shrink-0 text-xs text-muted-foreground transition-colors hover:text-danger disabled:opacity-50"
            >
              {busy === mount.id ? "working…" : "remove"}
            </button>
          </div>
        ))}
        <form
          className={`flex flex-wrap items-center gap-2 px-5 py-4 ${mounts.length === 0 ? "" : "border-t border-rule-faint"}`}
          onSubmit={(event) => {
            event.preventDefault();
            add(event.currentTarget);
          }}
        >
          <input
            name="name"
            placeholder="name (experiments)"
            className="w-36 rounded-lg border border-input bg-background px-2.5 py-1.5 font-mono text-xs text-foreground placeholder:text-faint"
          />
          <input
            name="hostPath"
            placeholder="/home/you/Developer/experiments"
            className="min-w-56 flex-1 rounded-lg border border-input bg-background px-2.5 py-1.5 font-mono text-xs text-foreground placeholder:text-faint"
          />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              name="readOnly"
              defaultChecked
              className="size-3.5 accent-[var(--sw-accent)]"
            />
            read-only
          </label>
          <button
            type="submit"
            disabled={busy !== null}
            className="rounded-xl border border-border bg-card px-3 py-1.5 font-mono text-xs text-foreground shadow-xs transition-transform hover:-translate-y-0.5 disabled:opacity-50"
          >
            {busy === "add" ? "adding…" : "add folder"}
          </button>
          {addError === null ? null : (
            <p className="w-full border-l-2 border-[var(--sw-red)] pl-2 text-xs text-danger">
              {addError}
            </p>
          )}
        </form>
      </div>
    </section>
  );
}

/**
 * References (plan §17, 2026-08-01): read-only clones of dependency sources.
 * The list is global; the checkbox is this project's selection — what its
 * next sessions mount at /workspace/ref/<name>. Running sessions keep the
 * mounts they launched with; the session records what it received.
 */
function ReferencesSection({ projectId }: { readonly projectId: string }) {
  const references = useSuspenseQuery(referencesQuery).data;
  const selected = useSuspenseQuery(projectReferencesQuery(projectId)).data;
  const selectedIds = new Set(selected.map((reference) => reference.id));
  const [busy, setBusy] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["references"] }),
      queryClient.invalidateQueries({ queryKey: ["project", projectId, "references"] }),
    ]);

  const toggle = (referenceId: string) => {
    const next = selectedIds.has(referenceId)
      ? [...selectedIds].filter((id) => id !== referenceId)
      : [...selectedIds, referenceId];
    setBusy(referenceId);
    void selectProjectReferences(projectId, next)
      .then(invalidate)
      .finally(() => setBusy(null));
  };

  const refresh = (referenceId: string) => {
    setBusy(referenceId);
    void refreshReference(referenceId)
      .then(invalidate)
      .finally(() => setBusy(null));
  };

  const remove = (referenceId: string) => {
    setBusy(referenceId);
    void removeReference(referenceId)
      .then(invalidate)
      .finally(() => setBusy(null));
  };

  const add = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const source = String(data.get("source") ?? "").trim();
    const ref = String(data.get("ref") ?? "").trim();
    if (name === "" || source === "") return;
    setBusy("add");
    setAddError(null);
    void addReference(name, source, ref === "" ? null : ref)
      .then(async (created) => {
        // A reference added from this page is meant for this project.
        await selectProjectReferences(projectId, [...selectedIds, created.id]);
        await invalidate();
        form.reset();
        return null;
      })
      .catch((error: unknown) => {
        setAddError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setBusy(null));
  };

  return (
    <section className="mt-9">
      <p className="text-xs font-medium text-label">References</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Read-only clones of dependency sources. Checked ones mount at{" "}
        <span className="font-mono text-xs">/workspace/ref/&lt;name&gt;</span> in this project's
        next sessions.
      </p>
      <div className="mt-3 overflow-hidden rounded-2xl bg-card shadow-sm">
        {references.map((reference, index) => (
          <div
            key={reference.id}
            className={`flex items-center justify-between gap-4 px-5 py-4 ${index === 0 ? "" : "border-t border-rule-faint"}`}
          >
            <label className="flex min-w-0 cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={selectedIds.has(reference.id)}
                disabled={busy !== null}
                onChange={() => toggle(reference.id)}
                className="size-4 accent-[var(--sw-accent)]"
              />
              <span className="min-w-0">
                <span className="block font-sans text-sm font-medium text-foreground">
                  {reference.name}
                </span>
                <span className="mt-1 block truncate font-mono text-xs text-faint">
                  {reference.originUrl}
                  {reference.pinnedRef === null ? "" : ` @ ${reference.pinnedRef}`}
                  {reference.headSha === null ? "" : ` · ${reference.headSha.slice(0, 7)}`}
                  {reference.refreshedAt === null
                    ? ""
                    : ` · fetched ${new Date(reference.refreshedAt).toLocaleDateString()}`}
                </span>
              </span>
            </label>
            <div className="flex shrink-0 items-center gap-3">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => refresh(reference.id)}
                className="text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                {busy === reference.id ? "working…" : "refresh"}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => remove(reference.id)}
                className="text-xs text-muted-foreground transition-colors hover:text-danger disabled:opacity-50"
              >
                remove
              </button>
            </div>
          </div>
        ))}
        <form
          className={`flex flex-wrap items-center gap-2 px-5 py-4 ${references.length === 0 ? "" : "border-t border-rule-faint"}`}
          onSubmit={(event) => {
            event.preventDefault();
            add(event.currentTarget);
          }}
        >
          <input
            name="name"
            placeholder="name (effect)"
            className="w-32 rounded-lg border border-input bg-background px-2.5 py-1.5 font-mono text-xs text-foreground placeholder:text-faint"
          />
          <input
            name="source"
            placeholder="https://github.com/Effect-TS/effect.git"
            className="min-w-56 flex-1 rounded-lg border border-input bg-background px-2.5 py-1.5 font-mono text-xs text-foreground placeholder:text-faint"
          />
          <input
            name="ref"
            placeholder="ref (optional)"
            className="w-28 rounded-lg border border-input bg-background px-2.5 py-1.5 font-mono text-xs text-foreground placeholder:text-faint"
          />
          <button
            type="submit"
            disabled={busy !== null}
            className="rounded-xl border border-border bg-card px-3 py-1.5 font-mono text-xs text-foreground shadow-xs transition-transform hover:-translate-y-0.5 disabled:opacity-50"
          >
            {busy === "add" ? "cloning…" : "add reference"}
          </button>
          {addError === null ? null : (
            <p className="w-full border-l-2 border-[var(--sw-red)] pl-2 text-xs text-danger">
              {addError}
            </p>
          )}
        </form>
      </div>
    </section>
  );
}

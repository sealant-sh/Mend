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
  removeProject,
  removeProjectMount,
  removeReference,
  removeSession,
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

const LIVE_STATES = new Set(["starting", "running", "waiting", "idle"]);

/** How each harness launches — mirrors the CLI's map; the server records either way. */
const HARNESSES: ReadonlyArray<{ readonly name: string; readonly argv: ReadonlyArray<string> }> = [
  { name: "claude", argv: ["claude"] },
  { name: "codex", argv: ["codex"] },
  { name: "opencode", argv: ["opencode"] },
];

function ProjectPage() {
  const { projectId } = Route.useParams();
  const { project, sessions, annotations } = useSuspenseQuery(projectDetailQuery(projectId)).data;
  const navigate = useNavigate();
  const [starting, setStarting] = useState<string | null>(null);
  const [clearing, setClearing] = useState<"idle" | "armed" | "working">("idle");
  useWorkbenchEvents();

  const live = sessions.filter((session) => LIVE_STATES.has(session.status));
  const settled = sessions.filter((session) => !LIVE_STATES.has(session.status));
  const ordered = [...live, ...settled];

  /** Second click executes — destructive actions confirm explicitly (plan §15). */
  const clearSettled = () => {
    if (clearing === "idle") {
      setClearing("armed");
      return;
    }
    if (clearing !== "armed") return;
    setClearing("working");
    void Promise.allSettled(settled.map((session) => removeSession(session.id))).finally(() => {
      setClearing("idle");
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    });
  };

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
      <div className="mx-auto max-w-[1100px]">
        <p className="ev-eyebrow">project</p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-foreground">
          {project.name}
        </h1>
        <p className="mt-2 font-mono text-xs text-faint">
          store {project.storePath} · {project.defaultBranch}
          {project.adoptedSha === null ? "" : `@${project.adoptedSha.slice(0, 7)}`}
          {project.originUrl === null ? "" : ` · origin ${project.originUrl}`}
        </p>

        <div className="mt-8 grid gap-12 border-t border-rule pt-8 lg:grid-cols-[minmax(0,1fr)_332px]">
          <section>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule pb-3">
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
            <div className="mt-4 overflow-hidden rounded-2xl border border-rule bg-card shadow-xs">
              {ordered.length === 0 ? (
                <p className="p-5 text-sm text-muted-foreground">
                  No sessions yet — start one above, or{" "}
                  <span className="font-mono text-xs">mend claude</span> in this repository. Either
                  way it runs in its own worktree, recorded.
                </p>
              ) : (
                ordered.map((session, index) => {
                  const annotation = annotations.find((row) => row.sessionId === session.id);
                  return (
                    <div
                      key={session.id}
                      className={`flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-secondary ${index === 0 ? "" : "border-t border-rule-faint"}`}
                    >
                      <Link
                        to="/sessions/$sessionId"
                        params={{ sessionId: session.id }}
                        className="min-w-0 flex-1 no-underline"
                      >
                        <p className="font-sans text-sm font-medium text-foreground">
                          {session.harness}
                          {session.label === null ? "" : ` — ${session.label}`}
                        </p>
                        <p className="mt-1 truncate font-mono text-xs text-faint">
                          {session.branch} · base {session.baseSha.slice(0, 12)}
                          {annotation !== undefined && annotation.openComments > 0 && (
                            <span className="text-ink-2">
                              {" "}
                              · {annotation.openComments} open comment
                              {annotation.openComments === 1 ? "" : "s"}
                            </span>
                          )}
                          {annotation?.pendingFollowUp === true && (
                            <span className="text-warning"> · follow-up pending</span>
                          )}
                        </p>
                      </Link>
                      {annotation?.changeId != null && (
                        <Link
                          to="/changes/$changeId"
                          params={{ changeId: annotation.changeId }}
                          className="shrink-0 font-sans text-xs font-medium text-muted-foreground no-underline transition-colors hover:text-foreground"
                        >
                          Review
                        </Link>
                      )}
                      <SessionStatusDot
                        status={session.status}
                        recorded={session.sealantRunId !== null}
                      />
                    </div>
                  );
                })
              )}
            </div>
            {settled.length > 0 && (
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  disabled={clearing === "working"}
                  onClick={clearSettled}
                  onBlur={() => setClearing((current) => (current === "armed" ? "idle" : current))}
                  className={`font-sans text-xs font-medium transition-colors ${clearing === "armed" ? "text-warning" : "text-muted-foreground hover:text-foreground"} disabled:opacity-50`}
                >
                  {clearing === "working"
                    ? "Clearing…"
                    : clearing === "armed"
                      ? `Really delete ${settled.length} settled session${settled.length === 1 ? "" : "s"}?`
                      : "Clear settled"}
                </button>
              </div>
            )}
          </section>

          <aside className="flex flex-col gap-10 lg:border-l lg:border-rule lg:pl-8">
            <ReferencesSection projectId={projectId} />
            <MountsSection projectId={projectId} />
            <RemoveProjectSection projectId={projectId} />
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

function RemoveProjectSection({ projectId }: { readonly projectId: string }) {
  const navigate = useNavigate();
  const [removing, setRemoving] = useState<"idle" | "armed" | "working">("idle");
  const [leftoverNote, setLeftoverNote] = useState<string | null>(null);

  const remove = () => {
    if (removing === "idle") {
      setRemoving("armed");
      return;
    }
    if (removing !== "armed") return;
    setRemoving("working");
    void removeProject(projectId)
      .then((report) => {
        if (report.leftover !== null) setLeftoverNote(report.leftover);
        void queryClient.invalidateQueries();
        return navigate({ to: "/projects" });
      })
      .catch(() => setRemoving("idle"));
  };

  return (
    <section className="border-t border-rule-faint pt-4">
      <button
        type="button"
        disabled={removing === "working"}
        onClick={remove}
        onBlur={() => setRemoving((current) => (current === "armed" ? "idle" : current))}
        className={`font-sans text-xs font-medium transition-colors disabled:opacity-50 ${removing === "armed" ? "text-danger" : "text-muted-foreground hover:text-danger"}`}
      >
        {removing === "working"
          ? "Removing…"
          : removing === "armed"
            ? "Really remove project and store copy?"
            : "Remove project…"}
      </button>
      {removing === "armed" && (
        <p className="mt-2 font-mono text-xs text-faint">
          Stops live sessions, deletes sessions and reviews, and removes the store copy. The origin
          repository is untouched.
        </p>
      )}
      {leftoverNote !== null && (
        <p className="mt-2 font-mono text-xs text-warning">
          some files would not delete (container-owned) — remaining at {leftoverNote}
        </p>
      )}
    </section>
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
  const [adding, setAdding] = useState(false);
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
        setAdding(false);
        return null;
      })
      .catch((error: unknown) => {
        setAddError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setBusy(null));
  };

  return (
    <section>
      <p className="border-b border-rule pb-2 text-xs font-medium text-label">Mounted folders</p>
      <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
        Host folders next sessions see at{" "}
        <span className="font-mono text-[11px]">/workspace/home/&lt;name&gt;</span>. Read-only
        unless deliberately chosen otherwise — the reviewed change stays the worktree.
      </p>
      <div className="mt-3 overflow-hidden rounded-2xl border border-rule bg-card shadow-xs">
        {mounts.map((mount, index) => (
          <div
            key={mount.id}
            className={`px-4 py-3 ${index === 0 ? "" : "border-t border-rule-faint"}`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate font-sans text-[13px] font-medium text-foreground">
                {mount.name}
                {mount.readOnly ? null : (
                  <span className="ml-2 font-mono text-[11px] text-warning">read-write</span>
                )}
              </p>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => remove(mount.id)}
                className="shrink-0 text-xs text-muted-foreground transition-colors hover:text-danger disabled:opacity-50"
              >
                {busy === mount.id ? "working…" : "remove"}
              </button>
            </div>
            <p className="mt-1 truncate font-mono text-[11px] text-faint">{mount.hostPath}</p>
          </div>
        ))}
        {adding ? (
          <form
            className={`flex flex-col gap-2 px-4 py-3 ${mounts.length === 0 ? "" : "border-t border-rule-faint"}`}
            onSubmit={(event) => {
              event.preventDefault();
              add(event.currentTarget);
            }}
          >
            <input
              name="name"
              autoFocus
              placeholder="name (experiments)"
              className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 font-mono text-xs text-foreground placeholder:text-faint"
            />
            <input
              name="hostPath"
              placeholder="/home/you/Developer/experiments"
              className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 font-mono text-xs text-foreground placeholder:text-faint"
            />
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  name="readOnly"
                  defaultChecked
                  className="size-3.5 accent-[var(--sw-accent)]"
                />
                read-only
              </label>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setAdding(false);
                    setAddError(null);
                  }}
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  cancel
                </button>
                <button
                  type="submit"
                  disabled={busy !== null}
                  className="rounded-xl border border-border bg-card px-3 py-1.5 font-mono text-xs text-foreground shadow-xs transition-transform hover:-translate-y-0.5 disabled:opacity-50"
                >
                  {busy === "add" ? "adding…" : "add folder"}
                </button>
              </div>
            </div>
            {addError === null ? null : (
              <p className="border-l-2 border-[var(--sw-red)] pl-2 text-xs text-danger">
                {addError}
              </p>
            )}
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className={`w-full px-4 py-2.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground ${mounts.length === 0 ? "" : "border-t border-rule-faint"}`}
          >
            + add folder…
          </button>
        )}
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
  const [adding, setAdding] = useState(false);
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
        setAdding(false);
        return null;
      })
      .catch((error: unknown) => {
        setAddError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setBusy(null));
  };

  return (
    <section>
      <p className="border-b border-rule pb-2 text-xs font-medium text-label">References</p>
      <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
        Read-only clones of dependency sources. Checked ones mount at{" "}
        <span className="font-mono text-[11px]">/workspace/ref/&lt;name&gt;</span> in next sessions.
      </p>
      <div className="mt-3 overflow-hidden rounded-2xl border border-rule bg-card shadow-xs">
        {references.map((reference, index) => (
          <div
            key={reference.id}
            title={reference.originUrl}
            className={`px-4 py-3 ${index === 0 ? "" : "border-t border-rule-faint"}`}
          >
            <div className="flex items-center justify-between gap-2">
              <label className="flex min-w-0 cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={selectedIds.has(reference.id)}
                  disabled={busy !== null}
                  onChange={() => toggle(reference.id)}
                  className="size-3.5 shrink-0 accent-[var(--sw-accent)]"
                />
                <span className="truncate font-sans text-[13px] font-medium text-foreground">
                  {reference.name}
                </span>
              </label>
              <div className="flex shrink-0 items-center gap-2.5">
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
            <p className="mt-1 truncate pl-6 font-mono text-[11px] text-faint">
              {reference.pinnedRef === null ? "" : `@${reference.pinnedRef} · `}
              {reference.headSha === null ? "" : `${reference.headSha.slice(0, 7)}`}
              {reference.refreshedAt === null
                ? ""
                : ` · fetched ${new Date(reference.refreshedAt).toLocaleDateString()}`}
            </p>
          </div>
        ))}
        {adding ? (
          <form
            className={`flex flex-col gap-2 px-4 py-3 ${references.length === 0 ? "" : "border-t border-rule-faint"}`}
            onSubmit={(event) => {
              event.preventDefault();
              add(event.currentTarget);
            }}
          >
            <input
              name="name"
              autoFocus
              placeholder="name (effect)"
              className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 font-mono text-xs text-foreground placeholder:text-faint"
            />
            <input
              name="source"
              placeholder="https://github.com/Effect-TS/effect.git"
              className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 font-mono text-xs text-foreground placeholder:text-faint"
            />
            <input
              name="ref"
              placeholder="ref (optional)"
              className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 font-mono text-xs text-foreground placeholder:text-faint"
            />
            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setAddError(null);
                }}
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                cancel
              </button>
              <button
                type="submit"
                disabled={busy !== null}
                className="rounded-xl border border-border bg-card px-3 py-1.5 font-mono text-xs text-foreground shadow-xs transition-transform hover:-translate-y-0.5 disabled:opacity-50"
              >
                {busy === "add" ? "cloning…" : "add reference"}
              </button>
            </div>
            {addError === null ? null : (
              <p className="border-l-2 border-[var(--sw-red)] pl-2 text-xs text-danger">
                {addError}
              </p>
            )}
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className={`w-full px-4 py-2.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground ${references.length === 0 ? "" : "border-t border-rule-faint"}`}
          >
            + add reference…
          </button>
        )}
      </div>
    </section>
  );
}

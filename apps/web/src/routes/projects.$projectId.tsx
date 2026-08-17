import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { useContextMenu } from "#/components/context-menu";
import { GitKeyCard } from "#/components/git-key-card";
import { AppShell } from "#/components/shell";
import { SessionStatusDot } from "#/components/status";
import {
  addProjectMount,
  addProjectRecipe,
  addReference,
  refreshReference,
  removeProject,
  removeProjectMount,
  removeProjectRecipe,
  removeReference,
  removeSession,
  selectProjectReferences,
  setProjectAutomation,
  setProjectApplyDotfiles,
  setProjectGitAuth,
  type AutomationChoiceDto,
  type GitAuthModeDto,
  type ProjectDto,
} from "#/lib/api";
import {
  gitBridgeQuery,
  gitKeyQuery,
  projectDetailQuery,
  projectEnvironmentQuery,
  projectSecretsQuery,
  projectMountsQuery,
  projectRecipesQuery,
  projectReferencesQuery,
  queryClient,
  referencesQuery,
  settingsQuery,
} from "#/lib/queries";
import { useWorkbenchEvents } from "#/lib/workbench-events";
import { HARNESSES, LIVE_STATES, sessionMenu, startSession } from "#/lib/workbench-menus";
import { workspaceImageSummary } from "#/lib/workspace-environment";

export const Route = createFileRoute("/projects/$projectId")({
  ssr: false,
  loader: async ({ params }) => {
    await Promise.all([
      queryClient.ensureQueryData(projectDetailQuery(params.projectId)),
      queryClient.ensureQueryData(referencesQuery),
      queryClient.ensureQueryData(projectReferencesQuery(params.projectId)),
      queryClient.ensureQueryData(projectMountsQuery(params.projectId)),
      queryClient.ensureQueryData(projectRecipesQuery(params.projectId)),
    ]);
  },
  component: ProjectPage,
});

function ProjectPage() {
  const { projectId } = Route.useParams();
  const { project, sessions, annotations } = useSuspenseQuery(projectDetailQuery(projectId)).data;
  const navigate = useNavigate();
  const [starting, setStarting] = useState<string | null>(null);
  const [clearing, setClearing] = useState<"idle" | "armed" | "working">("idle");
  const { openMenu, menuElement } = useContextMenu();
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

  const start = (harness: string) => {
    setStarting(harness);
    void startSession(navigate, projectId, harness).finally(() => setStarting(null));
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
                    key={harness}
                    type="button"
                    disabled={starting !== null}
                    onClick={() => start(harness)}
                    className="rounded-xl border border-border bg-card px-3 py-1.5 font-mono text-xs text-foreground shadow-xs transition-transform hover:-translate-y-0.5 disabled:opacity-50"
                  >
                    {starting === harness ? "starting…" : harness}
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
                      onContextMenu={(event) =>
                        openMenu(event, sessionMenu(session, annotation, navigate))
                      }
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
            <ServicesSection projectId={projectId} />
            <EnvironmentSection project={project} />
            <DotfilesSection project={project} />
            <GitAccessSection project={project} />
            <ReviewAutomationSection project={project} />
            <RemoveProjectSection projectId={projectId} />
          </aside>
        </div>
      </div>
      {menuElement}
    </AppShell>
  );
}

const AUTOMATION_ROWS: ReadonlyArray<{
  readonly key: "autoTour" | "autoSuggest";
  readonly label: string;
}> = [
  { key: "autoTour", label: "Description & tour" },
  { key: "autoSuggest", label: "Suggest fixes" },
];

const AUTOMATION_CHOICES: ReadonlyArray<{
  readonly value: AutomationChoiceDto;
  readonly label: string;
}> = [
  { value: "inherit", label: "inherit" },
  { value: "on", label: "on" },
  { value: "off", label: "off" },
];

const GIT_AUTH_CHOICES: ReadonlyArray<{
  readonly value: GitAuthModeDto;
  readonly label: string;
}> = [
  { value: "ambient", label: "ambient" },
  { value: "mend-key", label: "mend key" },
  { value: "bridge", label: "bridge" },
];

/**
 * How host-side git reaches this project's remote (docs/GIT-ACCESS.md):
 * ambient rides the login user's ssh setup; mend-key is a per-machine deploy
 * key whose public half this card hands out (switching generates it, so the
 * card can show it immediately); bridge signs through an ssh-agent shared
 * from another machine — presence is shown as an observation, and ops fail
 * readably while nobody is connected.
 */
function GitAccessSection({ project }: { readonly project: ProjectDto }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gitKey = useQuery({ ...gitKeyQuery, enabled: project.gitAuthMode === "mend-key" });
  const bridge = useQuery({ ...gitBridgeQuery, enabled: project.gitAuthMode === "bridge" });

  const choose = (value: GitAuthModeDto) => {
    if (project.gitAuthMode === value || busy) return;
    setBusy(true);
    setError(null);
    void setProjectGitAuth(project.id, value)
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: ["project", project.id] });
        void queryClient.invalidateQueries({ queryKey: ["git-key"] });
        return null;
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <section>
      <p className="border-b border-rule pb-2 text-xs font-medium text-label">Git access</p>
      <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
        How Mend reaches this project&apos;s remote. Ambient uses your login user&apos;s git and ssh
        setup; the Mend key is this machine&apos;s own deploy key; bridge signs through an ssh-agent
        shared from another machine with <span className="font-mono">mend keys share</span>.
      </p>
      <div className="mt-3 flex gap-1">
        {GIT_AUTH_CHOICES.map((choice) => (
          <button
            key={choice.value}
            type="button"
            disabled={busy}
            onClick={() => choose(choice.value)}
            className={`rounded-lg border px-2 py-1 font-mono text-[11px] transition-colors disabled:opacity-50 ${
              project.gitAuthMode === choice.value
                ? "border-[color-mix(in_oklab,var(--sw-accent)_45%,transparent)] bg-wash text-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {choice.label}
          </button>
        ))}
      </div>
      {error !== null && (
        <p className="mt-3 border-l-2 border-[var(--sw-red)] pl-2 text-xs text-danger">{error}</p>
      )}
      {project.gitAuthMode === "mend-key" && gitKey.data !== undefined && (
        <div className="mt-3">
          <GitKeyCard gitKey={gitKey.data} />
        </div>
      )}
      {project.gitAuthMode === "bridge" && bridge.data !== undefined && (
        <div className="mt-3">
          <p className="flex items-center gap-2 font-mono text-xs">
            <span
              className={`inline-block size-2 rounded-full ${
                bridge.data.connected
                  ? "bg-[var(--sw-green-dot)]"
                  : "border-[1.5px] border-[#b3b0a8]"
              }`}
            />
            <span className={bridge.data.connected ? "text-ink-2" : "text-faint"}>
              {bridge.data.connected
                ? `signer connected · ${bridge.data.clientName ?? "unknown machine"}`
                : "no signer connected"}
            </span>
          </p>
          {!bridge.data.connected && (
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Run <span className="font-mono">mend keys share</span> on the machine that holds your
              key; git ops for this project wait for no one — they fail readably until a signer
              connects.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Where the project's workspace environment now lives: a summary line (image + variable count)
 * and the door to the full-width Project environment page. The editors moved there — a sidebar
 * card is the wrong size for name/value configuration.
 */
function EnvironmentSection({ project }: { readonly project: ProjectDto }) {
  const settings = useQuery(settingsQuery);
  const environment = useQuery(projectEnvironmentQuery(project.id));
  const secrets = useQuery(projectSecretsQuery(project.id));
  const inherited = settings.data?.workspaceImage ?? null;
  const effective = project.workspaceImage ?? inherited;
  const count = environment.data?.variables.length;
  const secretCount = secrets.data?.secrets.length;

  return (
    <section>
      <p className="border-b border-rule pb-2 text-xs font-medium text-label">Environment</p>
      <p className="mt-2.5 font-mono text-xs text-ink-2">
        {effective === null ? "settings default" : workspaceImageSummary(effective)}
        {project.workspaceImage === null ? (
          <span className="text-faint"> · inherited</span>
        ) : (
          <span className="text-faint"> · project override</span>
        )}
      </p>
      <p className="mt-1 font-mono text-xs text-ink-2">
        {count === undefined
          ? "variables · …"
          : count === 0
            ? "variables · none"
            : `variables · ${count}`}
        <span className="text-faint">
          {secretCount === undefined
            ? " · secrets · …"
            : secretCount === 0
              ? " · secrets · none"
              : ` · secrets · ${secretCount}`}
        </span>
      </p>
      <Link
        to="/projects/$projectId/environment"
        params={{ projectId: project.id }}
        className="mt-2 inline-block font-sans text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        Open environment…
      </Link>
    </section>
  );
}

/**
 * Whether sessions in this project receive the launching user's dotfiles (repo + synced home
 * files, configured per account in Settings). A boolean, not a cascade: dotfiles are identity,
 * so the only project-level question is "does this project want them applied". Custom-image
 * projects skip dotfiles regardless — a BYO base brings its own environment, and the platform
 * rejects them there.
 */
function DotfilesSection({ project }: { readonly project: ProjectDto }) {
  const settings = useQuery(settingsQuery);
  const customImage = (project.workspaceImage ?? settings.data?.workspaceImage)?.mode === "custom";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = (applyDotfiles: boolean) => {
    setBusy(true);
    setError(null);
    void setProjectApplyDotfiles(project.id, applyDotfiles)
      .then(() => queryClient.invalidateQueries({ queryKey: ["project", project.id] }))
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Could not save the dotfiles switch."),
      )
      .finally(() => setBusy(false));
  };

  return (
    <section>
      <p className="border-b border-rule pb-2 text-xs font-medium text-label">Dotfiles</p>
      {customImage ? (
        <p className="mt-2.5 font-mono text-xs text-faint">custom image · dotfiles not applied</p>
      ) : (
        <div className="mt-2.5 flex items-center justify-between gap-3">
          <p className="min-w-0 font-mono text-xs text-ink-2">
            {project.applyDotfiles ? "your dotfiles · applied at launch" : "dotfiles · off"}
            <span className="text-faint"> · set up in Settings</span>
          </p>
          <div className="flex shrink-0 gap-1">
            {([true, false] as const).map((value) => (
              <button
                key={String(value)}
                type="button"
                disabled={busy}
                onClick={() => save(value)}
                className={`rounded-lg border px-2 py-1 font-mono text-[11px] transition-colors disabled:opacity-50 ${
                  project.applyDotfiles === value
                    ? "border-[color-mix(in_oklab,var(--sw-accent)_45%,transparent)] bg-wash text-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {value ? "on" : "off"}
              </button>
            ))}
          </div>
        </div>
      )}
      {error === null ? null : <p className="mt-2 text-xs leading-relaxed text-danger">{error}</p>}
    </section>
  );
}

function ReviewAutomationSection({ project }: { readonly project: ProjectDto }) {
  const [busy, setBusy] = useState<string | null>(null);

  const choose = (key: "autoTour" | "autoSuggest", value: AutomationChoiceDto) => {
    if (project[key] === value) return;
    setBusy(key);
    void setProjectAutomation(project.id, {
      autoTour: key === "autoTour" ? value : project.autoTour,
      autoSuggest: key === "autoSuggest" ? value : project.autoSuggest,
    })
      .then(() => queryClient.invalidateQueries({ queryKey: ["project", project.id] }))
      .finally(() => setBusy(null));
  };

  return (
    <section>
      <p className="border-b border-rule pb-2 text-xs font-medium text-label">Review automation</p>
      <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
        What Mend runs when a session settles here. Inherit follows the defaults in Settings.
      </p>
      <div className="mt-3 flex flex-col gap-3">
        {AUTOMATION_ROWS.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate font-sans text-[13px] font-medium text-foreground">
              {row.label}
            </p>
            <div className="flex shrink-0 gap-1">
              {AUTOMATION_CHOICES.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => choose(row.key, choice.value)}
                  className={`rounded-lg border px-2 py-1 font-mono text-[11px] transition-colors disabled:opacity-50 ${
                    project[row.key] === choice.value
                      ? "border-[color-mix(in_oklab,var(--sw-accent)_45%,transparent)] bg-wash text-foreground"
                      : "border-border bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
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
 * Declared Services (docs/SESSION-SERVICES.md): the project's recipes on this
 * machine — the web-editable twin of mend.toml. Sessions offer the union of
 * both as one-tap launchers; on a name collision the file wins.
 */
function ServicesSection({ projectId }: { readonly projectId: string }) {
  const recipes = useSuspenseQuery(projectRecipesQuery(projectId)).data;
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["project", projectId, "service-recipes"] });

  const remove = (name: string) => {
    setBusy(name);
    void removeProjectRecipe(projectId, name)
      .then(invalidate)
      .finally(() => setBusy(null));
  };

  const add = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const command = String(data.get("command") ?? "").trim();
    const port = Number(String(data.get("port") ?? "").trim());
    const protocol = data.get("udp") === "on" ? ("udp" as const) : ("tcp" as const);
    if (name === "" || !Number.isInteger(port)) return;
    setBusy("add");
    setAddError(null);
    void addProjectRecipe(projectId, {
      name,
      command: command === "" ? null : command,
      port,
      protocol,
    })
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
      <p className="border-b border-rule pb-2 text-xs font-medium text-label">Services</p>
      <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
        Commands sessions can run and expose — a dev server, a database. Every session offers these
        one tap away, beside whatever <span className="font-mono text-[11px]">mend.toml</span>{" "}
        declares in the repo. Leave the command empty to adopt an already-listening port.
      </p>
      <div className="mt-3 overflow-hidden rounded-2xl border border-rule bg-card shadow-xs">
        {recipes.map((recipe, index) => (
          <div
            key={recipe.name}
            className={`px-4 py-3 ${index === 0 ? "" : "border-t border-rule-faint"}`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate font-sans text-[13px] font-medium text-foreground">
                {recipe.name}
              </p>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => remove(recipe.name)}
                className="shrink-0 text-xs text-muted-foreground transition-colors hover:text-danger disabled:opacity-50"
              >
                {busy === recipe.name ? "working…" : "remove"}
              </button>
            </div>
            <p className="mt-1 truncate font-mono text-[11px] text-faint">
              {recipe.command ?? "adopt"} · :{recipe.port}
              {recipe.protocol === "udp" ? "/udp" : ""}
            </p>
          </div>
        ))}
        {adding ? (
          <form
            className={`flex flex-col gap-2 px-4 py-3 ${recipes.length === 0 ? "" : "border-t border-rule-faint"}`}
            onSubmit={(event) => {
              event.preventDefault();
              add(event.currentTarget);
            }}
          >
            <input
              name="name"
              autoFocus
              placeholder="name (web)"
              className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 font-mono text-xs text-foreground placeholder:text-faint"
            />
            <input
              name="command"
              placeholder="pnpm dev (empty = adopt a listening port)"
              className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 font-mono text-xs text-foreground placeholder:text-faint"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2.5">
                <input
                  name="port"
                  inputMode="numeric"
                  placeholder="port (3000)"
                  className="w-28 rounded-lg border border-input bg-background px-2.5 py-1.5 font-mono text-xs text-foreground placeholder:text-faint"
                />
                <label className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    name="udp"
                    className="size-3.5 accent-[var(--sw-accent)]"
                  />
                  udp
                </label>
              </span>
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
                  {busy === "add" ? "declaring…" : "declare service"}
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
            className={`w-full px-4 py-2.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground ${recipes.length === 0 ? "" : "border-t border-rule-faint"}`}
          >
            + declare service…
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

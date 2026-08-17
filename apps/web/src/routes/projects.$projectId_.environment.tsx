import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useReducer, useState } from "react";

import { AppShell } from "#/components/shell";
import {
  setProjectWorkspaceImage,
  type ProjectDto,
  type WorkspaceImageDto,
  type WorkspacePackageResolutionDto,
} from "#/lib/api";
import {
  createProjectEnvironmentVariable,
  createProjectSecret,
  removeProjectEnvironmentVariable,
  removeProjectSecret,
  updateProjectEnvironmentVariable,
  updateProjectSecret,
  type ProjectEnvironmentVariableView,
  type ProjectEnvironmentWriteResult,
  type ProjectSecretView,
  type ProjectSecretWriteResult,
} from "#/lib/project-environment";
import {
  clientIssues,
  clientSecretIssues,
  initialProjectEnvironmentForm,
  issuesFor,
  projectEnvironmentFormReducer,
} from "#/lib/project-environment-form";
import {
  projectDetailQuery,
  projectEnvironmentQuery,
  projectSecretsQuery,
  queryClient,
  settingsQuery,
} from "#/lib/queries";
import { copyText } from "#/lib/workbench-menus";
import {
  OS_LABELS,
  parsePackageDraft,
  resolutionIssue,
  workspaceImageSummary,
} from "#/lib/workspace-environment";

/**
 * Project environment (`.plans/project-environment-variables.md` §UI): the workspace image the
 * project's sessions build from, and the project's ordinary environment variables. A non-nested
 * route — the project page has no <Outlet>, so `$projectId_.` keeps this a sibling full page.
 */
export const Route = createFileRoute("/projects/$projectId_/environment")({
  ssr: false,
  loader: async ({ params }) => {
    await Promise.all([
      queryClient.ensureQueryData(projectDetailQuery(params.projectId)),
      queryClient.ensureQueryData(projectEnvironmentQuery(params.projectId)),
      queryClient.ensureQueryData(projectSecretsQuery(params.projectId)),
      queryClient.ensureQueryData(settingsQuery),
    ]);
  },
  component: ProjectEnvironmentPage,
});

function ProjectEnvironmentPage() {
  const { projectId } = Route.useParams();
  const { project } = useSuspenseQuery(projectDetailQuery(projectId)).data;

  return (
    <AppShell>
      <div className="mx-auto max-w-[760px]">
        <p className="ev-eyebrow">project · environment</p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-foreground">
          {project.name}
        </h1>
        <p className="mt-2 max-w-[64ch] text-sm leading-relaxed text-muted-foreground">
          Changes apply to new workspace launches, including when you resume a settled session.
          Running workspaces keep the configuration they started with.
        </p>
        <p className="mt-2">
          <Link
            to="/projects/$projectId"
            params={{ projectId }}
            className="font-sans text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            ← Back to project
          </Link>
        </p>

        <div className="mt-8 space-y-6">
          <WorkspaceImagePanel project={project} />
          <ConfigurationPanel projectId={projectId} />
          <SecretsPanel projectId={projectId} />
        </div>
      </div>
    </AppShell>
  );
}

// ── Workspace image (moved from the project sidebar; same behavior, panel chrome) ──────────────

const WORKSPACE_OS_CHOICES = ["arch", "fedora", "ubuntu", "nix"] as const;

/**
 * The project's workspace image: a managed OS family, or a custom base image
 * with exactly three knobs — base ref, extra packages, setup commands. Not a
 * compose editor: the workspace is one container; compose already lives
 * inside it (the dind sidecar). Null inherits the Settings default; sessions
 * record the image they actually launched with.
 */
function WorkspaceImagePanel({ project }: { readonly project: ProjectDto }) {
  const settings = useQuery(settingsQuery);
  const inherited = settings.data?.workspaceImage ?? null;
  const effective = project.workspaceImage ?? inherited;
  const [draft, setDraft] = useState<{
    readonly mode: "family" | "custom";
    readonly os: (typeof WORKSPACE_OS_CHOICES)[number];
    readonly shell: "bash" | "zsh" | "fish";
    readonly baseImage: string;
    readonly packagesDraft: string;
    readonly setupDraft: string;
    readonly docker: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejections, setRejections] = useState<ReadonlyArray<WorkspacePackageResolutionDto>>([]);

  const openEditor = () => {
    const from = effective;
    setError(null);
    setRejections([]);
    setDraft(
      from === null || from.mode === "family"
        ? {
            mode: "family",
            os: from === null ? "arch" : from.os,
            shell: from === null ? "bash" : from.shell,
            baseImage: "",
            packagesDraft: (from?.packages ?? []).join("\n"),
            setupDraft: "",
            docker: from?.services.docker ?? true,
          }
        : {
            mode: "custom",
            os: "arch",
            shell: "bash",
            baseImage: from.baseImage,
            packagesDraft: from.packages.join("\n"),
            setupDraft: from.setupCommands.join("\n"),
            docker: from.services.docker,
          },
    );
  };

  const save = (image: WorkspaceImageDto | null) => {
    setBusy(true);
    setError(null);
    setRejections([]);
    void setProjectWorkspaceImage(project.id, image)
      .then((result) => {
        if (!result.saved) {
          setRejections(result.resolutions.filter((r) => r.status !== "resolved" || !r.supported));
          return;
        }
        setDraft(null);
        return queryClient.invalidateQueries({ queryKey: ["project", project.id] });
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Could not save the workspace image."),
      )
      .finally(() => setBusy(false));
  };

  const draftImage = (): WorkspaceImageDto | null => {
    if (draft === null) return null;
    const packages = parsePackageDraft(draft.packagesDraft).packages;
    return draft.mode === "custom"
      ? {
          mode: "custom",
          baseImage: draft.baseImage.trim(),
          packages,
          setupCommands: draft.setupDraft
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line !== ""),
          services: { docker: draft.docker },
        }
      : {
          mode: "family",
          os: draft.os,
          packages,
          shell: draft.shell,
          services: { docker: draft.docker },
        };
  };

  return (
    <section className="rounded-2xl bg-panel p-6 shadow-[var(--shadow-sm)]">
      <h2 className="font-sans text-sm font-semibold">Workspace image</h2>
      {draft === null ? (
        <>
          <p className="mt-2.5 font-mono text-xs text-ink-2">
            {effective === null ? "settings default" : workspaceImageSummary(effective)}
            {project.workspaceImage === null ? (
              <span className="text-faint"> · inherited</span>
            ) : (
              <span className="text-faint"> · project override</span>
            )}
          </p>
          <button
            type="button"
            onClick={openEditor}
            className="mt-2 font-sans text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Edit…
          </button>
        </>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex gap-1">
            {(
              [
                { mode: "family", label: "os family" },
                { mode: "custom", label: "custom image" },
              ] as const
            ).map((option) => (
              <button
                key={option.mode}
                type="button"
                disabled={busy}
                onClick={() => setDraft({ ...draft, mode: option.mode })}
                className={`rounded-lg border px-2 py-1 font-mono text-[11px] transition-colors disabled:opacity-50 ${
                  draft.mode === option.mode
                    ? "border-[color-mix(in_oklab,var(--sw-accent)_45%,transparent)] bg-wash text-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {draft.mode === "family" ? (
            <>
              <div className="flex flex-wrap gap-1">
                {WORKSPACE_OS_CHOICES.map((os) => (
                  <button
                    key={os}
                    type="button"
                    disabled={busy}
                    onClick={() => setDraft({ ...draft, os })}
                    className={`rounded-lg border px-2 py-1 font-mono text-[11px] transition-colors disabled:opacity-50 ${
                      draft.os === os
                        ? "border-[color-mix(in_oklab,var(--sw-accent)_45%,transparent)] bg-wash text-foreground"
                        : "border-border bg-card text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {OS_LABELS[os].toLowerCase()}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-baseline gap-1">
                <span className="mr-1 text-[11px] text-muted-foreground">shell</span>
                {(["bash", "zsh", "fish"] as const).map((shell) => (
                  <button
                    key={shell}
                    type="button"
                    disabled={busy}
                    onClick={() => setDraft({ ...draft, shell })}
                    className={`rounded-lg border px-2 py-1 font-mono text-[11px] transition-colors disabled:opacity-50 ${
                      draft.shell === shell
                        ? "border-[color-mix(in_oklab,var(--sw-accent)_45%,transparent)] bg-wash text-foreground"
                        : "border-border bg-card text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {shell}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <input
                type="text"
                value={draft.baseImage}
                disabled={busy}
                placeholder="node:22-bookworm"
                spellCheck={false}
                aria-label="Base image reference"
                onChange={(event) => setDraft({ ...draft, baseImage: event.target.value })}
                className="w-full rounded-lg border border-input bg-card px-2.5 py-1.5 font-mono text-[11.5px] text-foreground outline-none transition-colors focus:border-[var(--sw-accent)]"
              />
              <textarea
                value={draft.setupDraft}
                disabled={busy}
                rows={2}
                spellCheck={false}
                placeholder="setup commands · one per line"
                aria-label="Setup commands"
                onChange={(event) => setDraft({ ...draft, setupDraft: event.target.value })}
                className="w-full resize-y rounded-lg border border-input bg-card px-2.5 py-1.5 font-mono text-[11.5px] leading-relaxed text-foreground outline-none transition-colors focus:border-[var(--sw-accent)]"
              />
            </>
          )}
          <textarea
            value={draft.packagesDraft}
            disabled={busy}
            rows={3}
            spellCheck={false}
            placeholder={
              draft.mode === "family" ? "packages · one per line" : "extra packages · one per line"
            }
            aria-label="Packages"
            onChange={(event) => setDraft({ ...draft, packagesDraft: event.target.value })}
            className="w-full resize-y rounded-lg border border-input bg-card px-2.5 py-1.5 font-mono text-[11.5px] leading-relaxed text-foreground outline-none transition-colors focus:border-[var(--sw-accent)]"
          />
          {rejections.length === 0 ? null : (
            <div className="flex flex-col gap-1">
              {rejections.map((resolution) => (
                <p key={resolution.requested} className="text-xs leading-relaxed text-danger">
                  <span className="font-mono">{resolution.requested}</span> ·{" "}
                  {resolutionIssue(resolution, draft.os)}
                </p>
              ))}
            </div>
          )}
          {error === null ? null : <p className="text-xs leading-relaxed text-danger">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || (draft.mode === "custom" && draft.baseImage.trim() === "")}
              onClick={() => save(draftImage())}
              className="rounded-lg border border-[color-mix(in_oklab,var(--sw-accent)_45%,transparent)] bg-wash px-2.5 py-1 font-sans text-xs font-medium text-foreground transition-colors disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save override"}
            </button>
            {project.workspaceImage !== null && (
              <button
                type="button"
                disabled={busy}
                onClick={() => save(null)}
                className="rounded-lg border border-border bg-card px-2.5 py-1 font-sans text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                Use default
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => setDraft(null)}
              className="font-sans text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Configuration: the project's ordinary environment variables ────────────────────────────────

const inputClass =
  "mt-1.5 w-full rounded-lg border border-input bg-card px-2.5 py-1.5 font-mono text-[12px] text-foreground outline-none transition-colors focus:border-[var(--sw-accent)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--sw-accent)_18%,transparent)] disabled:opacity-60";

/**
 * Ordinary name/value configuration, inherited by every process in the project's future
 * workspaces: the agent, shells you open later, Services, setup commands, checks. Explicitly not
 * a secret store — the panel says so before anything is typed, and secret-looking names are
 * refused with the same wording the server uses.
 */
function ConfigurationPanel({ projectId }: { readonly projectId: string }) {
  const environment = useSuspenseQuery(projectEnvironmentQuery(projectId)).data;
  const [form, dispatch] = useReducer(projectEnvironmentFormReducer, initialProjectEnvironmentForm);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["project", projectId, "environment"] });

  const settle = async (
    write: Promise<ProjectEnvironmentWriteResult>,
    notice: string,
  ): Promise<void> => {
    try {
      const outcome = await write;
      if (outcome.ok) {
        dispatch({ type: "save-succeeded", notice });
        await refresh();
        return;
      }
      if (outcome.kind === "rejected") {
        dispatch({ type: "save-rejected", issues: outcome.issues });
      } else if (outcome.kind === "stale") {
        dispatch({ type: "save-conflicted" });
      } else {
        dispatch({ type: "save-failed", message: `The save failed (${outcome.status}).` });
      }
    } catch (cause) {
      dispatch({
        type: "save-failed",
        message: cause instanceof Error ? cause.message : "The save failed.",
      });
    }
  };

  const submit = () => {
    if (form.editing === null || form.phase === "saving") return;
    // The exact policy the server re-applies — a bad name never round-trips.
    const found = clientIssues({ name: form.name, value: form.value });
    if (found.length > 0) {
      dispatch({ type: "save-rejected", issues: found });
      return;
    }
    dispatch({ type: "save-started" });
    if (form.editing.kind === "create") {
      void settle(
        createProjectEnvironmentVariable(projectId, { name: form.name, value: form.value }),
        `Saved ${form.name}.`,
      );
    } else {
      void settle(
        updateProjectEnvironmentVariable(projectId, form.editing.variableId, {
          name: form.name,
          value: form.value,
          expectedRevision: form.editing.expectedRevision,
        }),
        form.editing.originalName === form.name
          ? `Saved ${form.name}.`
          : `Renamed ${form.editing.originalName} to ${form.name}.`,
      );
    }
  };

  const nameIssues = issuesFor(form.issues, "name");
  const valueIssues = issuesFor(form.issues, "value");
  const aggregateIssues = issuesFor(form.issues, null);
  const editorOpen = form.editing !== null;
  const editingId = form.editing?.kind === "edit" ? form.editing.variableId : null;

  return (
    <section className="rounded-2xl bg-panel p-6 shadow-[var(--shadow-sm)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-sans text-sm font-semibold">Configuration</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            Environment variables for every process in this project’s workspaces — the agent,
            shells, Services, setup, and checks. Stored and sent as plaintext.
          </p>
        </div>
        {editorOpen ? null : (
          <button
            type="button"
            onClick={() => dispatch({ type: "create-opened" })}
            className="shrink-0 rounded-xl border border-border bg-card px-3 py-1.5 font-sans text-xs font-medium text-foreground shadow-xs transition-transform hover:-translate-y-0.5"
          >
            Add variable
          </button>
        )}
      </div>

      <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
        Passwords, tokens, and API keys belong in Secrets below — encrypted here, never persisted by
        the platform. Claude, Codex, and GitHub credentials use a connected account.
      </p>

      <p aria-live="polite" role="status" className="mt-2 text-xs text-success">
        {form.notice}
      </p>

      {form.editing?.kind === "create" ? (
        <EnvironmentEditor
          heading="New variable"
          form={form}
          nameIssues={nameIssues}
          valueIssues={valueIssues}
          aggregateIssues={aggregateIssues}
          dispatch={dispatch}
          submit={submit}
        />
      ) : null}

      <div className="mt-4 border-t border-[var(--sw-faint-rule)]">
        {environment.variables.length === 0 && !editorOpen ? (
          <p className="pt-4 text-sm text-muted-foreground">
            No variables yet. Each one is set on the workspace container at launch and inherited by
            everything Mend starts inside it.
          </p>
        ) : (
          <ul>
            {environment.variables.map((variable) =>
              editingId === variable.id ? (
                <li key={variable.id} className="border-b border-[var(--sw-faint-rule)]">
                  <EnvironmentEditor
                    heading={`Edit ${variable.name}`}
                    form={form}
                    nameIssues={nameIssues}
                    valueIssues={valueIssues}
                    aggregateIssues={aggregateIssues}
                    dispatch={dispatch}
                    submit={submit}
                  />
                </li>
              ) : (
                <VariableRow
                  key={variable.id}
                  projectId={projectId}
                  variable={variable}
                  disabled={editorOpen}
                  onEdit={() => dispatch({ type: "edit-opened", variable })}
                  onRemoved={async () => {
                    dispatch({ type: "save-succeeded", notice: `Removed ${variable.name}.` });
                    await refresh();
                  }}
                />
              ),
            )}
          </ul>
        )}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        Docker Compose may use these values for interpolation. Containers started by Compose or{" "}
        <span className="font-mono">docker run</span> receive only values your Compose file or
        command explicitly passes.
      </p>
    </section>
  );
}

function EnvironmentEditor({
  heading,
  form,
  nameIssues,
  valueIssues,
  aggregateIssues,
  dispatch,
  submit,
}: {
  readonly heading: string;
  readonly form: ReturnType<typeof projectEnvironmentFormReducer>;
  readonly nameIssues: ReadonlyArray<{ readonly message: string }>;
  readonly valueIssues: ReadonlyArray<{ readonly message: string }>;
  readonly aggregateIssues: ReadonlyArray<{ readonly message: string }>;
  readonly dispatch: (action: Parameters<typeof projectEnvironmentFormReducer>[1]) => void;
  readonly submit: () => void;
}) {
  const saving = form.phase === "saving";
  return (
    <form
      className="mt-4 rounded-xl border border-border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <p className="font-sans text-[13px] font-medium text-foreground">{heading}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
        <div>
          <label htmlFor="env-name" className="font-sans text-xs font-medium text-foreground">
            Name
          </label>
          <input
            id="env-name"
            type="text"
            value={form.name}
            disabled={saving}
            spellCheck={false}
            autoComplete="off"
            placeholder="APP_MODE"
            aria-invalid={nameIssues.length > 0}
            aria-describedby={nameIssues.length > 0 ? "env-name-issues" : undefined}
            onChange={(event) => dispatch({ type: "name-changed", name: event.target.value })}
            className={inputClass}
          />
          {nameIssues.length === 0 ? null : (
            <div id="env-name-issues">
              {nameIssues.map((issue) => (
                <p key={issue.message} className="mt-1.5 text-xs leading-relaxed text-danger">
                  {issue.message}
                </p>
              ))}
            </div>
          )}
        </div>
        <div>
          <label htmlFor="env-value" className="font-sans text-xs font-medium text-foreground">
            Value
          </label>
          <textarea
            id="env-value"
            value={form.value}
            disabled={saving}
            rows={1}
            spellCheck={false}
            placeholder="empty is allowed"
            aria-invalid={valueIssues.length > 0}
            aria-describedby={valueIssues.length > 0 ? "env-value-issues" : undefined}
            onChange={(event) => dispatch({ type: "value-changed", value: event.target.value })}
            className={`${inputClass} resize-y leading-relaxed`}
          />
          {valueIssues.length === 0 ? null : (
            <div id="env-value-issues">
              {valueIssues.map((issue) => (
                <p key={issue.message} className="mt-1.5 text-xs leading-relaxed text-danger">
                  {issue.message}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
      {aggregateIssues.map((issue) => (
        <p key={issue.message} className="mt-2 text-xs leading-relaxed text-danger">
          {issue.message}
        </p>
      ))}
      {form.conflict ? (
        <p className="mt-2 text-xs leading-relaxed text-warning" aria-live="polite">
          This variable changed elsewhere since you opened it. Your draft is kept — cancel to load
          the current value, then reapply what you want.
        </p>
      ) : null}
      {form.error === null ? null : (
        <p className="mt-2 text-xs leading-relaxed text-danger" aria-live="polite">
          {form.error}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg border border-[color-mix(in_oklab,var(--sw-accent)_45%,transparent)] bg-wash px-2.5 py-1 font-sans text-xs font-medium text-foreground transition-colors disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => dispatch({ type: "closed" })}
          className="font-sans text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function VariableRow({
  projectId,
  variable,
  disabled,
  onEdit,
  onRemoved,
}: {
  readonly projectId: string;
  readonly variable: ProjectEnvironmentVariableView;
  readonly disabled: boolean;
  readonly onEdit: () => void;
  readonly onRemoved: () => Promise<void>;
}) {
  const [removing, setRemoving] = useState<"idle" | "armed" | "working">("idle");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Second click executes — destructive actions confirm explicitly (plan §15). */
  const remove = () => {
    if (removing === "idle") {
      setRemoving("armed");
      return;
    }
    if (removing !== "armed") return;
    setRemoving("working");
    setError(null);
    void removeProjectEnvironmentVariable(projectId, variable.id, variable.revision)
      .then(async (outcome) => {
        if (outcome.ok) {
          await onRemoved();
          return undefined;
        }
        setError(
          outcome.kind === "stale"
            ? "This variable changed elsewhere — reload before removing it."
            : "The remove failed.",
        );
        return undefined;
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "The remove failed."),
      )
      .finally(() => setRemoving("idle"));
  };

  const copy = () => {
    copyText(`${variable.name}=${variable.value}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <li className="flex items-start justify-between gap-4 border-b border-[var(--sw-faint-rule)] py-3">
      <div className="min-w-0">
        <p className="font-mono text-[12.5px] font-medium text-foreground">{variable.name}</p>
        <p className="mt-0.5 font-mono text-[12px] break-all whitespace-pre-wrap text-ink-2">
          {variable.value === "" ? <span className="text-faint">(empty)</span> : variable.value}
        </p>
        {error === null ? null : (
          <p className="mt-1 text-xs leading-relaxed text-danger" aria-live="polite">
            {error}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        <button
          type="button"
          disabled={disabled}
          onClick={copy}
          className="font-sans text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          aria-live="polite"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onEdit}
          className="font-sans text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          Edit
        </button>
        <button
          type="button"
          disabled={disabled || removing === "working"}
          onClick={remove}
          className={`font-sans text-xs font-medium transition-colors disabled:opacity-50 ${
            removing === "armed" ? "text-danger" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {removing === "armed"
            ? "Remove? Running workspaces keep it"
            : removing === "working"
              ? "Removing…"
              : "Remove"}
        </button>
      </div>
    </li>
  );
}

// ── Secrets: encrypted at rest, write-only, delivered through the transient secret channel ─────

/**
 * The half of a real `.env` that Configuration refuses. Values are sealed with this machine's key
 * before they touch the database and are never returned by any response — the row shows a name,
 * that a value is set, and when. At launch the set is unsealed once and handed to the platform's
 * transient secret channel: never persisted there, never in container env or `docker inspect`,
 * masked in captured output.
 */
function SecretsPanel({ projectId }: { readonly projectId: string }) {
  const snapshot = useSuspenseQuery(projectSecretsQuery(projectId)).data;
  const [form, dispatch] = useReducer(projectEnvironmentFormReducer, initialProjectEnvironmentForm);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["project", projectId, "secrets"] });

  const settle = async (
    write: Promise<ProjectSecretWriteResult>,
    notice: string,
  ): Promise<void> => {
    try {
      const outcome = await write;
      if (outcome.ok) {
        dispatch({ type: "save-succeeded", notice });
        await refresh();
        return;
      }
      if (outcome.kind === "rejected") {
        dispatch({ type: "save-rejected", issues: outcome.issues });
      } else if (outcome.kind === "stale") {
        dispatch({ type: "save-conflicted" });
      } else {
        dispatch({ type: "save-failed", message: `The save failed (${outcome.status}).` });
      }
    } catch (cause) {
      dispatch({
        type: "save-failed",
        message: cause instanceof Error ? cause.message : "The save failed.",
      });
    }
  };

  const submit = () => {
    if (form.editing === null || form.phase === "saving") return;
    const editing = form.editing;
    // On edit, an empty value means "keep the stored value" (it cannot be shown to be re-entered).
    const replacing = editing.kind === "create" || form.value !== "";
    const found = clientSecretIssues({ name: form.name, value: replacing ? form.value : null });
    if (found.length > 0) {
      dispatch({ type: "save-rejected", issues: found });
      return;
    }
    dispatch({ type: "save-started" });
    if (editing.kind === "create") {
      void settle(
        createProjectSecret(projectId, { name: form.name, value: form.value }),
        `Saved secret ${form.name}.`,
      );
    } else {
      void settle(
        updateProjectSecret(projectId, editing.variableId, {
          name: form.name,
          value: replacing ? form.value : null,
          expectedRevision: editing.expectedRevision,
        }),
        replacing
          ? `Replaced secret ${form.name}.`
          : editing.originalName === form.name
            ? `Saved secret ${form.name}.`
            : `Renamed secret ${editing.originalName} to ${form.name}.`,
      );
    }
  };

  const nameIssues = issuesFor(form.issues, "name");
  const valueIssues = issuesFor(form.issues, "value");
  const aggregateIssues = issuesFor(form.issues, null);
  const editorOpen = form.editing !== null;
  const editingId = form.editing?.kind === "edit" ? form.editing.variableId : null;

  return (
    <section className="rounded-2xl bg-panel p-6 shadow-[var(--shadow-sm)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-sans text-sm font-semibold">Secrets</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            API keys, database URLs, anything a dev server needs that must not be stored in the
            clear. Encrypted on this machine; the platform never persists them and masks them in
            recorded output. Set once — a value cannot be read back, only replaced.
          </p>
        </div>
        {editorOpen ? null : (
          <button
            type="button"
            onClick={() => dispatch({ type: "create-opened" })}
            className="shrink-0 rounded-xl border border-border bg-card px-3 py-1.5 font-sans text-xs font-medium text-foreground shadow-xs transition-transform hover:-translate-y-0.5"
          >
            Add secret
          </button>
        )}
      </div>

      <p aria-live="polite" role="status" className="mt-2 text-xs text-success">
        {form.notice}
      </p>

      {form.editing?.kind === "create" ? (
        <SecretEditor
          heading="New secret"
          form={form}
          nameIssues={nameIssues}
          valueIssues={valueIssues}
          aggregateIssues={aggregateIssues}
          dispatch={dispatch}
          submit={submit}
        />
      ) : null}

      <div className="mt-4 border-t border-[var(--sw-faint-rule)]">
        {snapshot.secrets.length === 0 && !editorOpen ? (
          <p className="pt-4 text-sm text-muted-foreground">
            No secrets yet. Or load a whole file from the repository:{" "}
            <span className="font-mono">mend env load</span>.
          </p>
        ) : (
          <ul>
            {snapshot.secrets.map((secret) =>
              editingId === secret.id ? (
                <li key={secret.id} className="border-b border-[var(--sw-faint-rule)]">
                  <SecretEditor
                    heading={`Edit ${secret.name}`}
                    form={form}
                    nameIssues={nameIssues}
                    valueIssues={valueIssues}
                    aggregateIssues={aggregateIssues}
                    dispatch={dispatch}
                    submit={submit}
                  />
                </li>
              ) : (
                <SecretRow
                  key={secret.id}
                  projectId={projectId}
                  secret={secret}
                  disabled={editorOpen}
                  onEdit={() =>
                    dispatch({
                      type: "edit-opened",
                      // The reducer pre-fills `value` from the row; a secret row has none to give.
                      variable: {
                        id: secret.id,
                        projectId: secret.projectId,
                        name: secret.name,
                        value: "",
                        revision: secret.revision,
                        createdAt: secret.createdAt,
                        updatedAt: secret.updatedAt,
                      },
                    })
                  }
                  onRemoved={async () => {
                    dispatch({ type: "save-succeeded", notice: `Removed secret ${secret.name}.` });
                    await refresh();
                  }}
                />
              ),
            )}
          </ul>
        )}
      </div>
    </section>
  );
}

function SecretEditor({
  heading,
  form,
  nameIssues,
  valueIssues,
  aggregateIssues,
  dispatch,
  submit,
}: {
  readonly heading: string;
  readonly form: ReturnType<typeof projectEnvironmentFormReducer>;
  readonly nameIssues: ReadonlyArray<{ readonly message: string }>;
  readonly valueIssues: ReadonlyArray<{ readonly message: string }>;
  readonly aggregateIssues: ReadonlyArray<{ readonly message: string }>;
  readonly dispatch: (action: Parameters<typeof projectEnvironmentFormReducer>[1]) => void;
  readonly submit: () => void;
}) {
  const saving = form.phase === "saving";
  const editing = form.editing?.kind === "edit";
  return (
    <form
      className="mt-4 rounded-xl border border-border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <p className="font-sans text-[13px] font-medium text-foreground">{heading}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
        <div>
          <label htmlFor="secret-name" className="font-sans text-xs font-medium text-foreground">
            Name
          </label>
          <input
            id="secret-name"
            type="text"
            value={form.name}
            disabled={saving}
            spellCheck={false}
            autoComplete="off"
            placeholder="STRIPE_API_KEY"
            aria-invalid={nameIssues.length > 0}
            aria-describedby={nameIssues.length > 0 ? "secret-name-issues" : undefined}
            onChange={(event) => dispatch({ type: "name-changed", name: event.target.value })}
            className={inputClass}
          />
          {nameIssues.length === 0 ? null : (
            <div id="secret-name-issues">
              {nameIssues.map((issue) => (
                <p key={issue.message} className="mt-1.5 text-xs leading-relaxed text-danger">
                  {issue.message}
                </p>
              ))}
            </div>
          )}
        </div>
        <div>
          <label htmlFor="secret-value" className="font-sans text-xs font-medium text-foreground">
            {editing ? "New value" : "Value"}
          </label>
          <input
            id="secret-value"
            type="password"
            value={form.value}
            disabled={saving}
            spellCheck={false}
            autoComplete="off"
            placeholder={editing ? "leave empty to keep the stored value" : ""}
            aria-invalid={valueIssues.length > 0}
            aria-describedby={valueIssues.length > 0 ? "secret-value-issues" : undefined}
            onChange={(event) => dispatch({ type: "value-changed", value: event.target.value })}
            className={inputClass}
          />
          {valueIssues.length === 0 ? null : (
            <div id="secret-value-issues">
              {valueIssues.map((issue) => (
                <p key={issue.message} className="mt-1.5 text-xs leading-relaxed text-danger">
                  {issue.message}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
      {aggregateIssues.map((issue) => (
        <p key={issue.message} className="mt-2 text-xs leading-relaxed text-danger">
          {issue.message}
        </p>
      ))}
      {form.conflict ? (
        <p className="mt-2 text-xs leading-relaxed text-warning" aria-live="polite">
          This secret changed elsewhere since you opened it. Your draft is kept — cancel to reload,
          then reapply what you want.
        </p>
      ) : null}
      {form.error === null ? null : (
        <p className="mt-2 text-xs leading-relaxed text-danger" aria-live="polite">
          {form.error}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg border border-[color-mix(in_oklab,var(--sw-accent)_45%,transparent)] bg-wash px-2.5 py-1 font-sans text-xs font-medium text-foreground transition-colors disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => dispatch({ type: "closed" })}
          className="font-sans text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function SecretRow({
  projectId,
  secret,
  disabled,
  onEdit,
  onRemoved,
}: {
  readonly projectId: string;
  readonly secret: ProjectSecretView;
  readonly disabled: boolean;
  readonly onEdit: () => void;
  readonly onRemoved: () => Promise<void>;
}) {
  const [removing, setRemoving] = useState<"idle" | "armed" | "working">("idle");
  const [error, setError] = useState<string | null>(null);

  const remove = () => {
    if (removing === "idle") {
      setRemoving("armed");
      return;
    }
    if (removing !== "armed") return;
    setRemoving("working");
    setError(null);
    void removeProjectSecret(projectId, secret.id, secret.revision)
      .then(async (outcome) => {
        if (outcome.ok) {
          await onRemoved();
          return undefined;
        }
        setError(
          outcome.kind === "stale"
            ? "This secret changed elsewhere — reload before removing it."
            : "The remove failed.",
        );
        return undefined;
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "The remove failed."),
      )
      .finally(() => setRemoving("idle"));
  };

  return (
    <li className="flex items-start justify-between gap-4 border-b border-[var(--sw-faint-rule)] py-3">
      <div className="min-w-0">
        <p className="font-mono text-[12.5px] font-medium text-foreground">{secret.name}</p>
        <p className="mt-0.5 font-mono text-[12px] text-faint">
          value set · updated {new Date(secret.updatedAt).toLocaleString()}
        </p>
        {error === null ? null : (
          <p className="mt-1 text-xs leading-relaxed text-danger" aria-live="polite">
            {error}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        <button
          type="button"
          disabled={disabled}
          onClick={onEdit}
          className="font-sans text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          Replace
        </button>
        <button
          type="button"
          disabled={disabled || removing === "working"}
          onClick={remove}
          className={`font-sans text-xs font-medium transition-colors disabled:opacity-50 ${
            removing === "armed" ? "text-danger" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {removing === "armed"
            ? "Remove? Running workspaces keep it"
            : removing === "working"
              ? "Removing…"
              : "Remove"}
        </button>
      </div>
    </li>
  );
}

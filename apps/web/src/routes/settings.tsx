import { dotfilesRepositoriesEqual } from "@mend/domain";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useReducer, useState } from "react";

import { AppShell } from "#/components/shell";
import {
  deleteDotfilesSnapshot,
  postDotfilesSnapshot,
  putDotfilesRepository,
  putSettings,
  saveWorkspaceEnvironment,
  scanHostEnvironment,
  sealantConnection,
  type DotfilesDto,
  type DotfilesRepositoryDto,
  type HostEnvironmentSuggestionsDto,
  type SealantConnectionDto,
  type SettingsDto,
} from "#/lib/api";
import { dotfilesQuery, queryClient, settingsQuery } from "#/lib/queries";
import { setThemePreference, useThemePreference, type ThemePreference } from "#/lib/theme";
import {
  createWorkspaceEnvironmentForm,
  OS_LABELS,
  parsePackageDraft,
  resolutionIssue,
  workspaceEnvironmentFormReducer,
  workspaceImageFromForm,
  workspaceImagesEqual,
} from "#/lib/workspace-environment";

export const Route = createFileRoute("/settings")({
  ssr: false,
  loader: async () => {
    await Promise.all([
      queryClient.ensureQueryData(settingsQuery),
      queryClient.ensureQueryData(dotfilesQuery),
    ]);
    return sealantConnection();
  },
  component: SettingsPage,
});

function SettingsPage() {
  const connection = Route.useLoaderData();

  return (
    <AppShell>
      <div className="mb-8">
        <p className="ev-eyebrow">settings</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.02em]">Settings</h1>
        <p className="mt-2 max-w-[64ch] text-sm leading-relaxed text-muted-foreground">
          Mend runs on your Sealant: workspaces, recordings, and every model call go through the
          runtime you point it at.
        </p>
      </div>
      <div className="max-w-2xl space-y-6">
        <ThemePanel />
        <WorkspaceEnvironmentPanel />
        <DotfilesPanel />
        <ReviewAutomationPanel />
        <SealantConnectionPanel connection={connection} />
      </div>
    </AppShell>
  );
}

const OS_OPTIONS: ReadonlyArray<{
  readonly value: Extract<SettingsDto["workspaceImage"], { mode: "family" }>["os"];
  readonly label: string;
  readonly detail: string;
}> = [
  { value: "arch", label: "Arch", detail: "Rolling packages; Mend’s default." },
  { value: "fedora", label: "Fedora", detail: "Fedora 41 packages." },
  { value: "ubuntu", label: "Ubuntu", detail: "Ubuntu 24.04 LTS packages." },
  { value: "nix", label: "Nix", detail: "Tools resolved from nixpkgs." },
];

function WorkspaceEnvironmentPanel() {
  const settings = useSuspenseQuery(settingsQuery).data;
  const [form, dispatch] = useReducer(
    workspaceEnvironmentFormReducer,
    settings.workspaceImage,
    createWorkspaceEnvironmentForm,
  );
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<HostEnvironmentSuggestionsDto | null>(null);

  const pending = form.phase === "saving";
  const parsedDraft = parsePackageDraft(form.packageDraft);
  const candidate = workspaceImageFromForm(form);
  const dirty = !workspaceImagesEqual(form.savedImage, candidate);
  const rejectedResolutions = (form.resolutions ?? []).flatMap((resolution) => {
    const issue = resolutionIssue(resolution, form.os);
    return issue === null ? [] : [{ resolution, issue }];
  });

  const persist = async () => {
    dispatch({ type: "save-started" });
    try {
      const result = await saveWorkspaceEnvironment(candidate);
      if (!result.saved) {
        dispatch({ type: "save-rejected", resolutions: result.resolutions });
        return;
      }
      const saved = result.settings.workspaceImage;
      dispatch({ type: "save-succeeded", workspaceImage: saved, resolutions: result.resolutions });
      queryClient.setQueryData<SettingsDto>(settingsQuery.queryKey, (current) =>
        current === undefined ? result.settings : { ...current, workspaceImage: saved },
      );
    } catch (cause) {
      dispatch({
        type: "save-failed",
        message:
          cause instanceof Error
            ? cause.message
            : "Could not validate and save the workspace environment.",
      });
    }
  };

  const applySuggestions = () => {
    if (suggestions === null) return;
    const suggestedPackages = suggestions.tools
      .filter((tool) => tool.kind === "package")
      .map((tool) => tool.id);
    const dockerObserved = suggestions.tools.some(
      (tool) => tool.kind === "service" && tool.id === "docker",
    );
    dispatch({ type: "suggestions-applied", packageIds: suggestedPackages, dockerObserved });
  };

  return (
    <section className="rounded-2xl bg-panel p-6 shadow-[var(--shadow-sm)]">
      <h2 className="font-sans text-sm font-semibold">Workspace environment</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        Applied whenever a session starts or resumes. Workspaces already running are unchanged.
      </p>

      <div className="mt-5 border-t border-[var(--sw-faint-rule)] pt-5">
        <div className="flex items-start justify-between gap-4">
          <p className="font-sans text-sm font-medium text-foreground">Base</p>
          <div className="flex shrink-0 gap-2">
            {(
              [
                { mode: "family", label: "OS family" },
                { mode: "custom", label: "Custom image" },
              ] as const
            ).map((option) => (
              <button
                key={option.mode}
                type="button"
                disabled={pending}
                onClick={() => dispatch({ type: "mode-changed", mode: option.mode })}
                className={`rounded-xl border px-3.5 py-1.5 font-sans text-xs font-medium shadow-xs transition-colors disabled:opacity-60 ${
                  form.mode === option.mode
                    ? "border-[color-mix(in_oklab,var(--sw-accent)_45%,transparent)] bg-wash text-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        {form.mode === "family" ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {OS_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={pending}
                onClick={() => dispatch({ type: "os-changed", os: option.value })}
                className={`rounded-xl border p-3 text-left shadow-xs transition-colors disabled:opacity-60 ${
                  form.os === option.value
                    ? "border-[color-mix(in_oklab,var(--sw-accent)_45%,transparent)] bg-wash"
                    : "border-border bg-card hover:border-input"
                }`}
              >
                <span className="block font-sans text-sm font-medium text-foreground">
                  {option.label}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  {option.detail}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-3 space-y-4">
            <div>
              <label
                htmlFor="workspace-base-image"
                className="font-sans text-[13px] font-medium text-foreground"
              >
                Base image
              </label>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                Any Linux image with a shell, node + npm, and git. Sealant overlays only its
                supervisor and the agent CLIs.
              </p>
              <input
                id="workspace-base-image"
                type="text"
                value={form.baseImage}
                disabled={pending}
                placeholder="node:22-bookworm"
                spellCheck={false}
                onChange={(event) =>
                  dispatch({ type: "base-image-changed", baseImage: event.target.value })
                }
                className="mt-2 w-full rounded-xl border border-input bg-card px-3.5 py-2.5 font-mono text-[12.5px] text-foreground outline-none transition-colors focus:border-[var(--sw-accent)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--sw-accent)_18%,transparent)] disabled:opacity-60"
              />
            </div>
            <div>
              <label
                htmlFor="workspace-setup-commands"
                className="font-sans text-[13px] font-medium text-foreground"
              >
                Setup commands
              </label>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                One command per line, run in the fresh workspace before the agent starts. A failing
                command fails the launch.
              </p>
              <textarea
                id="workspace-setup-commands"
                value={form.setupDraft}
                disabled={pending}
                rows={3}
                spellCheck={false}
                onChange={(event) =>
                  dispatch({ type: "setup-changed", setupDraft: event.target.value })
                }
                className="mt-2 w-full resize-y rounded-xl border border-input bg-card px-3.5 py-2.5 font-mono text-[12.5px] leading-relaxed text-foreground outline-none transition-colors focus:border-[var(--sw-accent)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--sw-accent)_18%,transparent)] disabled:opacity-60"
              />
            </div>
          </div>
        )}
      </div>

      {form.mode === "family" ? (
        <div className="mt-6 border-t border-[var(--sw-faint-rule)] pt-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-sans text-sm font-medium text-foreground">Login shell</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                Installed and set as the session’s login shell, so your shell config actually
                applies.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              {(["bash", "zsh", "fish"] as const).map((shell) => (
                <button
                  key={shell}
                  type="button"
                  disabled={pending}
                  onClick={() => dispatch({ type: "shell-changed", shell })}
                  className={`rounded-xl border px-3.5 py-1.5 font-mono text-xs shadow-xs transition-colors disabled:opacity-60 ${
                    form.shell === shell
                      ? "border-[color-mix(in_oklab,var(--sw-accent)_45%,transparent)] bg-wash text-foreground"
                      : "border-border bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {shell}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-6 border-t border-[var(--sw-faint-rule)] pt-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-sans text-sm font-medium text-foreground">Docker service</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              A disposable daemon belongs to the workspace. Mend never mounts the host Docker
              socket.
            </p>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() => dispatch({ type: "docker-toggled" })}
            className={`shrink-0 rounded-xl border px-3.5 py-1.5 font-sans text-xs font-medium shadow-xs transition-colors disabled:opacity-60 ${
              form.docker
                ? "border-[color-mix(in_oklab,var(--sw-accent)_45%,transparent)] bg-wash text-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {form.docker ? "Enabled" : "Disabled"}
          </button>
        </div>
      </div>

      <div className="mt-6 border-t border-[var(--sw-faint-rule)] pt-5">
        <label
          htmlFor="workspace-packages"
          className="font-sans text-sm font-medium text-foreground"
        >
          Packages
        </label>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          {form.mode === "family"
            ? "One package per line. Sealant resolves every entry for the selected operating system before Mend saves it."
            : "One package per line, passed verbatim to the base image’s own package manager (apt, apk, dnf, or pacman)."}
        </p>
        <textarea
          id="workspace-packages"
          value={form.packageDraft}
          disabled={pending}
          onChange={(event) =>
            dispatch({ type: "packages-changed", packageDraft: event.target.value })
          }
          rows={8}
          spellCheck={false}
          className="mt-3 w-full resize-y rounded-xl border border-input bg-card px-3.5 py-3 font-mono text-[12.5px] leading-relaxed text-foreground outline-none transition-colors focus:border-[var(--sw-accent)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--sw-accent)_18%,transparent)] disabled:opacity-60"
        />
        <p className="mt-3 text-xs text-muted-foreground">
          {parsedDraft.packages.length} package{parsedDraft.packages.length === 1 ? "" : "s"}
          {form.mode === "family"
            ? ` · checked for ${OS_LABELS[form.os]} on save`
            : " · unchecked (custom base)"}
        </p>
        {parsedDraft.invalid === null ? null : (
          <p className="mt-2 text-xs text-danger">
            Unsupported package syntax: {parsedDraft.invalid}
          </p>
        )}
        {rejectedResolutions.length === 0 ? null : (
          <div className="mt-4 divide-y divide-[var(--sw-faint-rule)] border-y border-[var(--sw-faint-rule)]">
            {rejectedResolutions.map(({ resolution, issue }) => (
              <div key={resolution.requested} className="flex gap-3 py-3">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-danger-dot" aria-hidden />
                <div className="min-w-0">
                  <p className="font-mono text-[12.5px] text-ink-2">{resolution.requested}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-danger">{issue}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 border-t border-[var(--sw-faint-rule)] pt-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-sans text-sm font-medium text-foreground">
              Suggestions from this machine
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Checks a fixed list of executable and config paths on the machine running Mend. It
              does not list your home directory or read config contents.
            </p>
          </div>
          <button
            type="button"
            disabled={scanning}
            onClick={() => {
              setScanning(true);
              setScanError(null);
              void scanHostEnvironment()
                .then(setSuggestions)
                .catch((cause: unknown) =>
                  setScanError(
                    cause instanceof Error ? cause.message : "Could not scan this machine.",
                  ),
                )
                .finally(() => setScanning(false));
            }}
            className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-xl border border-border bg-panel px-3.5 font-sans text-[13px] font-medium text-foreground shadow-[var(--shadow-xs)] transition-[transform,border-color] hover:-translate-y-0.5 hover:border-input disabled:pointer-events-none disabled:opacity-60"
          >
            {scanning ? "Scanning…" : "Scan machine"}
          </button>
        </div>

        {suggestions === null ? null : (
          <div className="mt-4 space-y-4">
            <div className="divide-y divide-[var(--sw-faint-rule)] border-y border-[var(--sw-faint-rule)]">
              {suggestions.tools.map((tool) => (
                <div
                  key={`${tool.kind}:${tool.id}`}
                  className="flex items-baseline justify-between gap-4 py-2.5"
                >
                  <span className="font-mono text-[12.5px] text-ink-2">{tool.executable}</span>
                  <span className="text-xs text-muted-foreground">
                    {tool.kind === "service" ? "workspace service" : tool.id}
                  </span>
                </div>
              ))}
              {suggestions.tools.length === 0 ? (
                <p className="py-3 text-[13px] text-muted-foreground">No known tools observed.</p>
              ) : null}
            </div>
            {suggestions.tools.length === 0 ? null : (
              <button
                type="button"
                disabled={pending}
                onClick={applySuggestions}
                className="rounded-xl border border-border bg-card px-3.5 py-2 font-sans text-[13px] font-medium text-foreground shadow-xs transition-transform hover:-translate-y-0.5 disabled:opacity-60"
              >
                Add observed tools to draft
              </button>
            )}
            {suggestions.configs.length === 0 ? null : (
              <div>
                <p className="font-sans text-xs font-medium text-muted-foreground">
                  Config candidates · presence observed
                </p>
                <div className="mt-2 space-y-2">
                  {suggestions.configs.map((config) => (
                    <div key={config.path} className="flex items-baseline gap-3">
                      <span className="w-24 shrink-0 text-xs text-muted-foreground">
                        {config.label}
                      </span>
                      <span className="font-mono text-[12.5px] text-ink-2">{config.path}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between gap-4 border-t border-[var(--sw-faint-rule)] pt-5">
        <div className="flex min-w-0 items-center gap-2.5 text-[13px]">
          {form.phase === "saved" ? (
            <>
              <span className="size-2 shrink-0 rounded-full bg-success-dot" aria-hidden />
              <span className="text-success">Saved · packages resolved by Sealant</span>
            </>
          ) : (
            <span className={dirty ? "text-foreground" : "text-muted-foreground"}>
              {dirty ? "Unsaved environment changes" : "No environment changes"}
            </span>
          )}
        </div>
        <button
          type="button"
          disabled={
            pending ||
            !dirty ||
            parsedDraft.invalid !== null ||
            (form.mode === "custom" && form.baseImage.trim() === "")
          }
          onClick={() => void persist()}
          className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-xl bg-primary px-4 font-sans text-[13px] font-medium text-primary-foreground shadow-[var(--shadow-cobalt)] transition-transform hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-60"
        >
          {pending ? "Checking packages…" : "Save environment"}
        </button>
      </div>

      {form.error === null && scanError === null ? null : (
        <p className="mt-4 border-l-2 border-danger pl-3 text-[13px] text-danger">
          {form.error ?? scanError}
        </p>
      )}
    </section>
  );
}

/** Bytes as a terse mono fact: 812 B, 4.1 KB. Dotfiles are small; MB is already suspicious. */
const formatBytes = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;

const shortSha = (sha: string) => sha.slice(0, 7);

const syncedAgo = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

/** A picked file staged for upload; the target path is editable before it is committed. */
interface StagedDotfile {
  readonly path: string;
  readonly contentsBase64: string;
  readonly bytes: number;
}

function DotfilesPanel() {
  const dotfiles = useSuspenseQuery(dotfilesQuery).data;
  const savedRepo = dotfiles.repository;
  const [repoUrl, setRepoUrl] = useState(savedRepo?.url ?? "");
  const [repoRef, setRepoRef] = useState(savedRepo?.ref ?? "");
  const [bootstrap, setBootstrap] = useState(savedRepo?.bootstrap ?? true);
  const [staged, setStaged] = useState<ReadonlyArray<StagedDotfile>>([]);
  const [busy, setBusy] = useState<"repo" | "snapshot" | null>(null);
  const [saved, setSaved] = useState<"repo" | "snapshot" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const repoDraft: DotfilesRepositoryDto | null =
    repoUrl.trim() === ""
      ? null
      : {
          url: repoUrl.trim(),
          ref: repoRef.trim() === "" ? null : repoRef.trim(),
          manager: savedRepo?.manager ?? "auto",
          bootstrap,
        };
  const repoDirty = !dotfilesRepositoriesEqual(savedRepo, repoDraft);

  const applyResult = (next: DotfilesDto, which: "repo" | "snapshot") => {
    queryClient.setQueryData<DotfilesDto>(dotfilesQuery.queryKey, next);
    setRepoUrl(next.repository?.url ?? "");
    setRepoRef(next.repository?.ref ?? "");
    setBootstrap(next.repository?.bootstrap ?? true);
    setSaved(which);
  };

  const saveRepository = async () => {
    setBusy("repo");
    setSaved(null);
    setError(null);
    try {
      applyResult(await putDotfilesRepository(repoDraft), "repo");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the repository.");
    } finally {
      setBusy(null);
    }
  };

  const stageFiles = (list: FileList | null) => {
    if (list === null) return;
    setSaved(null);
    for (const file of list) {
      void file.arrayBuffer().then((buffer) => {
        const contentsBase64 = btoa(
          Array.from(new Uint8Array(buffer), (byte) => String.fromCharCode(byte)).join(""),
        );
        setStaged((current) => [
          ...current.filter((entry) => entry.path !== file.name),
          { path: file.name, contentsBase64, bytes: buffer.byteLength },
        ]);
      });
    }
  };

  const commitStaged = async () => {
    setBusy("snapshot");
    setSaved(null);
    setError(null);
    try {
      const next = await postDotfilesSnapshot({
        files: staged.map(({ path, contentsBase64 }) => ({ path, contentsBase64 })),
        source: "web",
        merge: true,
      });
      setStaged([]);
      applyResult(next, "snapshot");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add the files.");
    } finally {
      setBusy(null);
    }
  };

  const removeSnapshot = async () => {
    setBusy("snapshot");
    setSaved(null);
    setError(null);
    try {
      applyResult(await deleteDotfilesSnapshot(), "snapshot");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove the snapshot.");
    } finally {
      setBusy(null);
    }
  };

  const snapshot = dotfiles.snapshot;
  const pending = busy !== null;

  return (
    <section className="rounded-2xl bg-panel p-6 shadow-[var(--shadow-sm)]">
      <h2 className="font-sans text-sm font-semibold">Dotfiles</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        Your own environment, applied before the agent starts — yours, per account. File contents
        are captured on the machine that has them and stored here; the workspace only ever receives
        file trees, never a URL or a credential. This server’s home directory is never read.
      </p>

      <div className="mt-5 border-t border-[var(--sw-faint-rule)] pt-5">
        <label
          htmlFor="dotfiles-repo-url"
          className="font-sans text-sm font-medium text-foreground"
        >
          Dotfiles repository
        </label>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          Cloned by this server at every launch — chezmoi and stow layouts are detected, anything
          else is copied into the home directory. Leave empty for none.
        </p>
        <input
          id="dotfiles-repo-url"
          type="text"
          value={repoUrl}
          disabled={pending}
          placeholder="https://github.com/you/dotfiles.git"
          spellCheck={false}
          onChange={(event) => {
            setSaved(null);
            setRepoUrl(event.target.value);
          }}
          className="mt-2 w-full rounded-xl border border-input bg-card px-3.5 py-2.5 font-mono text-[12.5px] text-foreground outline-none transition-colors focus:border-[var(--sw-accent)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--sw-accent)_18%,transparent)] disabled:opacity-60"
        />
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
          {repoUrl.trim() === "" ? null : (
            <>
              <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <span>Branch</span>
                <input
                  type="text"
                  value={repoRef}
                  disabled={pending}
                  placeholder="default"
                  spellCheck={false}
                  onChange={(event) => {
                    setSaved(null);
                    setRepoRef(event.target.value);
                  }}
                  className="w-36 rounded-lg border border-input bg-card px-2.5 py-1.5 font-mono text-xs text-foreground outline-none transition-colors focus:border-[var(--sw-accent)] disabled:opacity-60"
                />
              </label>
              <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={bootstrap}
                  disabled={pending}
                  onChange={() => {
                    setSaved(null);
                    setBootstrap((current) => !current);
                  }}
                  className="size-3.5 accent-[var(--sw-accent)]"
                />
                <span>
                  Run <span className="font-mono text-xs text-ink-2">./install.sh</span> when
                  present
                </span>
              </label>
            </>
          )}
          <button
            type="button"
            disabled={pending || !repoDirty}
            onClick={() => void saveRepository()}
            className="ml-auto inline-flex min-h-8 shrink-0 items-center justify-center rounded-xl border border-border bg-panel px-3.5 font-sans text-[13px] font-medium text-foreground shadow-[var(--shadow-xs)] transition-[transform,border-color] hover:-translate-y-0.5 hover:border-input disabled:pointer-events-none disabled:opacity-60"
          >
            {busy === "repo" ? "Saving…" : "Save repository"}
          </button>
        </div>
      </div>

      <div className="mt-6 border-t border-[var(--sw-faint-rule)] pt-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-sans text-sm font-medium text-foreground">Home files</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Synced from your own machine with{" "}
              <span className="font-mono text-xs text-ink-2">mend dotfiles sync</span>, or added
              here. Files land relative to the workspace home and overwrite same-named repo files.
            </p>
          </div>
          <label className="inline-flex min-h-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-border bg-panel px-3.5 font-sans text-[13px] font-medium text-foreground shadow-[var(--shadow-xs)] transition-[transform,border-color] hover:-translate-y-0.5 hover:border-input">
            Add files…
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                stageFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
        </div>

        {snapshot === null && staged.length === 0 ? (
          <p className="mt-4 font-mono text-xs text-faint">no snapshot · nothing rides along yet</p>
        ) : null}

        {snapshot === null ? null : (
          <div className="mt-4">
            <p className="font-mono text-xs text-ink-2">
              {snapshot.files.length} file{snapshot.files.length === 1 ? "" : "s"} · synced{" "}
              {syncedAgo(snapshot.committedAt)} from {snapshot.source} ·{" "}
              <span className="text-faint">{shortSha(snapshot.sha)}</span>
            </p>
            <div className="mt-2 divide-y divide-[var(--sw-faint-rule)] border-y border-[var(--sw-faint-rule)]">
              {snapshot.files.map((file) => (
                <div key={file.path} className="flex items-baseline justify-between gap-4 py-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink-2">
                    {file.path}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-faint">
                    {formatBytes(file.bytes)}
                  </span>
                </div>
              ))}
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() => void removeSnapshot()}
              className="mt-2 font-sans text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
            >
              Remove snapshot
            </button>
          </div>
        )}

        {staged.length === 0 ? null : (
          <div className="mt-4">
            <p className="font-sans text-xs font-medium text-muted-foreground">
              staged · edit the target path before adding
            </p>
            <div className="mt-1 divide-y divide-[var(--sw-faint-rule)]">
              {staged.map((entry, index) => (
                <div key={entry.path} className="flex items-center gap-3 py-2">
                  <input
                    type="text"
                    value={entry.path}
                    disabled={pending}
                    spellCheck={false}
                    aria-label="Target path, relative to the home directory"
                    onChange={(event) =>
                      setStaged((current) =>
                        current.map((candidate, i) =>
                          i === index ? { ...candidate, path: event.target.value } : candidate,
                        ),
                      )
                    }
                    className="min-w-0 flex-1 rounded-lg border border-input bg-card px-2.5 py-1.5 font-mono text-xs text-foreground outline-none transition-colors focus:border-[var(--sw-accent)] disabled:opacity-60"
                  />
                  <span className="shrink-0 font-mono text-xs text-faint">
                    {formatBytes(entry.bytes)}
                  </span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setStaged((current) => current.filter((_, i) => i !== index))}
                    className="shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              disabled={pending || staged.some((entry) => entry.path.trim() === "")}
              onClick={() => void commitStaged()}
              className="mt-3 inline-flex min-h-9 items-center justify-center rounded-xl bg-primary px-4 font-sans text-[13px] font-medium text-primary-foreground shadow-[var(--shadow-cobalt)] transition-transform hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-60"
            >
              {busy === "snapshot" ? "Adding…" : "Add to snapshot"}
            </button>
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between gap-4 border-t border-[var(--sw-faint-rule)] pt-5">
        {saved !== null ? (
          <span className="flex items-center gap-2.5 text-[13px]">
            <span className="size-2 shrink-0 rounded-full bg-success-dot" aria-hidden />
            <span className="text-success">Saved · applies from the next launch</span>
          </span>
        ) : (
          <span className="font-mono text-xs text-faint">
            repo · {savedRepo === null ? "none" : "set"} — snapshot ·{" "}
            {snapshot === null
              ? "none"
              : `${snapshot.files.length} files @ ${shortSha(snapshot.sha)}`}
          </span>
        )}
      </div>

      {error === null ? null : (
        <p className="mt-4 border-l-2 border-danger pl-3 text-[13px] text-danger">{error}</p>
      )}
    </section>
  );
}

const AUTOMATION_ROWS: ReadonlyArray<{
  readonly key: "autoTour" | "autoSuggest";
  readonly label: string;
  readonly detail: string;
}> = [
  {
    key: "autoTour",
    label: "Compose the description & tour",
    detail:
      "Runs at session settle. The review page opens with the description and tour already composed.",
  },
  {
    key: "autoSuggest",
    label: "Suggest fixes",
    detail:
      "Runs at session settle. Drafts replacement suggestions only for concrete defects; most changes produce none.",
  },
];

/**
 * Review automation defaults — the cascade's root. Every project follows
 * these unless it overrides them on its own page (inherit · on · off).
 */
function ReviewAutomationPanel() {
  const settings = useSuspenseQuery(settingsQuery).data;
  const [pending, setPending] = useState<"autoTour" | "autoSuggest" | null>(null);

  const toggle = (key: "autoTour" | "autoSuggest", value: boolean) => {
    if (settings[key] === value) return;
    setPending(key);
    const next: SettingsDto = { ...settings, [key]: value };
    void putSettings(next)
      .then(() => queryClient.invalidateQueries({ queryKey: ["settings"] }))
      .finally(() => setPending(null));
  };

  return (
    <section className="rounded-2xl bg-panel p-6 shadow-[var(--shadow-sm)]">
      <h2 className="font-sans text-sm font-semibold">Review automation</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        What runs when a session settles. Defaults for every project; a project can override either
        switch on its own page.
      </p>
      <div className="mt-5 space-y-5 border-t border-[var(--sw-faint-rule)] pt-5">
        {AUTOMATION_ROWS.map((row) => (
          <div key={row.key} className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-sans text-sm font-medium text-foreground">{row.label}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{row.detail}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              {[true, false].map((value) => (
                <button
                  key={String(value)}
                  type="button"
                  disabled={pending !== null}
                  onClick={() => toggle(row.key, value)}
                  className={`rounded-xl border px-3.5 py-1.5 font-sans text-xs font-medium shadow-xs transition-colors disabled:opacity-60 ${
                    settings[row.key] === value
                      ? "border-[color-mix(in_oklab,var(--sw-accent)_45%,transparent)] bg-wash text-foreground"
                      : "border-border bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {value ? "On" : "Off"}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const STATUS_COPY: Record<
  SealantConnectionDto["status"],
  { readonly word: string; readonly dotClass: string; readonly textClass: string }
> = {
  connected: {
    word: "Connected · observed",
    dotClass: "bg-success-dot",
    textClass: "text-success",
  },
  unauthorized: { word: "Unauthorized", dotClass: "bg-danger-dot", textClass: "text-danger" },
  mismatched: {
    word: "Responded · surface mismatch",
    dotClass: "bg-[var(--sw-amber)]",
    textClass: "text-warning",
  },
  unreachable: { word: "Unreachable", dotClass: "bg-danger-dot", textClass: "text-danger" },
};

const THEME_OPTIONS: ReadonlyArray<{ readonly value: ThemePreference; readonly label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Light and dark are one structure (DESIGN.md §1); System tracks the OS live. */
function ThemePanel() {
  const preference = useThemePreference();
  return (
    <section className="rounded-2xl bg-panel p-6 shadow-[var(--shadow-sm)]">
      <h2 className="font-sans text-sm font-semibold">Theme</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        The warm-dark counterpart of the same system — identical structure, cobalt brightened to
        read on dark.
      </p>
      <div className="mt-4 flex gap-2">
        {THEME_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setThemePreference(option.value)}
            className={`rounded-xl border px-4 py-1.5 font-sans text-sm font-medium shadow-xs transition-colors ${
              preference === option.value
                ? "border-[color-mix(in_oklab,var(--sw-accent)_45%,transparent)] bg-wash text-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function SealantConnectionPanel({ connection }: { readonly connection: SealantConnectionDto }) {
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const status = STATUS_COPY[connection.status];

  return (
    <section className="rounded-2xl bg-panel p-6 shadow-[var(--shadow-sm)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-sans text-sm font-semibold">Sealant connection</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            A live round-trip to the control plane, checked from this instance.
          </p>
        </div>
        <button
          type="button"
          disabled={checking}
          className="inline-flex min-h-9 items-center justify-center rounded-xl border border-border bg-panel px-3.5 font-sans text-[13px] font-medium text-foreground shadow-[var(--shadow-xs)] transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-input disabled:pointer-events-none disabled:opacity-60"
          onClick={() => {
            setChecking(true);
            void router.invalidate().finally(() => setChecking(false));
          }}
        >
          {checking ? "Checking…" : "Check again"}
        </button>
      </div>
      <div className="mt-5 space-y-3 border-t border-[var(--sw-faint-rule)] pt-5">
        <div className="flex items-center gap-2.5">
          <span className={`size-2 rounded-full ${status.dotClass}`} aria-hidden="true" />
          <span className={`font-sans text-sm font-medium ${status.textClass}`}>{status.word}</span>
        </div>
        <Row label="control plane" value={connection.baseUrl} />
        <Row label="checked" value={new Date(connection.checkedAt).toLocaleString()} />
        {connection.detail === null ? null : <Row label="observed" value={connection.detail} />}
      </div>
    </section>
  );
}

function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-28 shrink-0 font-mono text-xs uppercase tracking-[0.06em] text-label">
        {label}
      </span>
      <span className="break-all font-mono text-[12.5px] text-ink-2">{value}</span>
    </div>
  );
}

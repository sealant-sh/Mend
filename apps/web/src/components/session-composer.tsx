import {
  EFFORT_LEVELS,
  FAST_CAPABLE_HARNESSES,
  HARNESS_MODELS,
  type EffortLevel,
  type PermissionMode,
} from "@mend/domain/workbench";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check, ChevronDown } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ProjectDto } from "#/lib/api";
import { refreshProjectBranches } from "#/lib/api";
import {
  effectiveHarnessPrefs,
  setComposerHarness,
  setComposerHarnessPrefs,
  setComposerProject,
  useComposerPrefs,
} from "#/lib/composer-prefs";
import { HARNESSES, startComposedSession, type Harness } from "#/lib/session-launch";
import { useTRPC } from "#/lib/trpc";

/**
 * The start-a-session composer: the prompt is the session's first message
 * (it rides the launch argv and seeds auto-naming); the quiet pill row
 * carries harness, model, and settings. One component, two mounts — the
 * Now view adds a project pill, a project page fixes the project. Shell is
 * not a composer harness (nothing to prompt) — the project page has its own
 * "Open a shell" action instead.
 */

/** Harnesses the composer offers — the promptable ones. */
const COMPOSER_HARNESSES = HARNESSES.filter((choice) => choice !== "shell");

type MenuKind = "project" | "harness" | "model" | "settings" | "options";

interface MenuState {
  readonly kind: MenuKind;
  readonly anchor: { readonly left: number; readonly bottom: number };
}

export function SessionComposer({
  projects,
  fixedProjectId,
}: {
  readonly projects: ReadonlyArray<ProjectDto>;
  /** When set the project pill is hidden and this project is the target. */
  readonly fixedProjectId?: string;
}) {
  const navigate = useNavigate();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const prefs = useComposerPrefs();
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [base, setBase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fallbackProjectId =
    prefs.lastProjectId !== null && projects.some((project) => project.id === prefs.lastProjectId)
      ? prefs.lastProjectId
      : (projects[0]?.id ?? null);
  const projectId = fixedProjectId ?? pickedProjectId ?? fallbackProjectId;
  const project = projects.find((row) => row.id === projectId);

  // Branches load when the settings sheet opens (a bare compose never pays for them);
  // "refresh" fetches origin through the project's git auth and re-reads the list.
  const branchesOpen = menu?.kind === "settings" || menu?.kind === "options";
  const branchesQuery = useQuery({
    ...trpc.projects.branches.queryOptions({ id: projectId ?? "" }),
    enabled: branchesOpen && projectId !== null,
  });
  const [refreshing, setRefreshing] = useState(false);

  if (projectId === null || project === undefined) return null;

  const refreshBranches = async () => {
    setRefreshing(true);
    try {
      await refreshProjectBranches(projectId);
      await queryClient.invalidateQueries({
        queryKey: trpc.projects.branches.queryOptions({ id: projectId }).queryKey,
      });
    } finally {
      setRefreshing(false);
    }
  };
  const branchFilter = base.trim();
  const visibleBranches = (branchesQuery.data ?? [])
    .filter((branch) => branchFilter === "" || branch.name.includes(branchFilter))
    .slice(0, 8);

  // A sticky "shell" from before shell left the composer degrades to claude.
  const stickyHarness = prefs.byProject[projectId]?.harness ?? "claude";
  const harness: Harness = stickyHarness === "shell" ? "claude" : stickyHarness;
  const harnessPrefs = effectiveHarnessPrefs(prefs, projectId, harness);

  const openMenu = (kind: MenuKind) => (event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu((current) =>
      current?.kind === kind ? null : { kind, anchor: { left: rect.left, bottom: rect.bottom } },
    );
  };

  const submit = () => {
    if (busy) return;
    const body = prompt.trim();
    if (body.startsWith("-")) {
      setError("A prompt cannot start with “-” — the harness would read it as a flag.");
      return;
    }
    setBusy(true);
    setError(null);
    setComposerProject(projectId);
    void startComposedSession(navigate, { queryClient, trpc }, projectId, {
      harness,
      prompt: body,
      ...(harnessPrefs.model !== null ? { model: harnessPrefs.model } : {}),
      ...(harnessPrefs.effort !== null ? { effort: harnessPrefs.effort } : {}),
      ...(harnessPrefs.permission !== null ? { permissionMode: harnessPrefs.permission } : {}),
      ...(harnessPrefs.speed !== null ? { speed: harnessPrefs.speed } : {}),
      ...(base.trim() === "" ? {} : { base: base.trim() }),
    }).catch((cause: unknown) => {
      setBusy(false);
      setError(cause instanceof Error ? `Could not start — ${cause.message}` : "Could not start.");
    });
  };

  const settingsSummary = [
    harnessPrefs.effort,
    harnessPrefs.speed === "fast" ? "fast" : null,
    harnessPrefs.permission === "ask" ? "ask" : null,
    base.trim() === "" ? null : base.trim(),
  ].filter((part): part is string => part !== null);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="rounded-2xl border border-rule bg-panel shadow-sm transition-[border-color,box-shadow] focus-within:border-[var(--sw-accent)] focus-within:shadow-md"
    >
      <textarea
        ref={textareaRef}
        value={prompt}
        autoFocus
        rows={1}
        placeholder="What should the session do?"
        onChange={(event) => setPrompt(event.target.value)}
        onInput={(event) => {
          const el = event.currentTarget;
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") event.currentTarget.blur();
          if (event.key !== "Enter") return;
          if (event.nativeEvent.isComposing) return;
          if (event.shiftKey) return;
          event.preventDefault();
          submit();
        }}
        className="block max-h-[200px] min-h-[70px] w-full resize-none bg-transparent px-4 pt-3.5 font-sans text-sm leading-relaxed text-foreground outline-none placeholder:text-faint disabled:cursor-default"
      />
      {error !== null && <p className="px-4 pt-1 font-sans text-xs text-danger">{error}</p>}
      <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {fixedProjectId === undefined && projects.length > 1 && (
            <ComposerPill onClick={openMenu("project")} open={menu?.kind === "project"}>
              <span className="truncate font-sans">{project.name}</span>
            </ComposerPill>
          )}
          <ComposerPill onClick={openMenu("harness")} open={menu?.kind === "harness"}>
            <span className="font-mono text-[12px]">{harness}</span>
          </ComposerPill>
          <ComposerPill
            className="hidden sm:inline-flex"
            onClick={openMenu("model")}
            open={menu?.kind === "model"}
          >
            <span className="font-mono text-[12px]">{harnessPrefs.model ?? "model"}</span>
          </ComposerPill>
          <ComposerPill
            className="hidden sm:inline-flex"
            onClick={openMenu("settings")}
            open={menu?.kind === "settings"}
          >
            <span className="font-mono text-[12px]">
              {settingsSummary.length === 0 ? "settings" : settingsSummary.join(" · ")}
            </span>
          </ComposerPill>
          <ComposerPill
            className="sm:hidden"
            onClick={openMenu("options")}
            open={menu?.kind === "options"}
          >
            <span className="font-sans">options</span>
          </ComposerPill>
        </div>
        <button
          type="submit"
          disabled={busy}
          onPointerDown={(event) => event.preventDefault()}
          className="h-8 shrink-0 rounded-xl bg-primary px-3.5 font-sans text-[13px] font-medium text-primary-foreground shadow-[var(--shadow-cobalt)] transition-transform hover:-translate-y-0.5 disabled:opacity-50"
        >
          {busy ? "Starting…" : "Start"}
        </button>
      </div>
      {menu !== null && (
        <ComposerMenu state={menu} onClose={() => setMenu(null)}>
          {menu.kind === "project" && (
            <MenuRadioGroup
              items={projects.map((row) => ({
                key: row.id,
                label: row.name,
                selected: row.id === projectId,
                onSelect: () => {
                  setPickedProjectId(row.id);
                  setComposerProject(row.id);
                  setMenu(null);
                },
              }))}
            />
          )}
          {menu.kind === "harness" && (
            <MenuRadioGroup
              mono
              items={COMPOSER_HARNESSES.map((choice) => ({
                key: choice,
                label: choice,
                selected: choice === harness,
                onSelect: () => {
                  setComposerHarness(projectId, choice);
                  setMenu(null);
                },
              }))}
            />
          )}
          {(menu.kind === "model" || menu.kind === "options") && (
            <MenuRadioGroup
              label={menu.kind === "options" ? "Model" : undefined}
              items={(HARNESS_MODELS[harness] ?? []).map((option) => ({
                key: option.id,
                label: option.label,
                detail: option.id,
                selected: option.id === harnessPrefs.model,
                onSelect: () => {
                  setComposerHarnessPrefs(projectId, harness, { model: option.id });
                  if (menu.kind === "model") setMenu(null);
                },
              }))}
            />
          )}
          {(menu.kind === "settings" || menu.kind === "options") && (
            <>
              <MenuRadioGroup
                label="Thinking"
                mono
                items={[
                  {
                    key: "default",
                    label: "default",
                    selected: harnessPrefs.effort === null,
                    onSelect: () => setComposerHarnessPrefs(projectId, harness, { effort: null }),
                  },
                  ...EFFORT_LEVELS.map((level: EffortLevel) => ({
                    key: level,
                    label: level,
                    selected: harnessPrefs.effort === level,
                    onSelect: () => setComposerHarnessPrefs(projectId, harness, { effort: level }),
                  })),
                ]}
              />
              {FAST_CAPABLE_HARNESSES.has(harness) && (
                <MenuRadioGroup
                  label="Speed"
                  items={[
                    {
                      key: "standard",
                      label: "Standard",
                      selected: harnessPrefs.speed !== "fast",
                      onSelect: () => setComposerHarnessPrefs(projectId, harness, { speed: null }),
                    },
                    {
                      key: "fast",
                      label: "Fast",
                      detail: "1.5× · more usage",
                      selected: harnessPrefs.speed === "fast",
                      onSelect: () =>
                        setComposerHarnessPrefs(projectId, harness, { speed: "fast" }),
                    },
                  ]}
                />
              )}
              <MenuRadioGroup
                label="Permissions"
                items={(
                  [
                    ["bypass", "Skip permission prompts"],
                    ["ask", "Ask before acting"],
                  ] as ReadonlyArray<readonly [PermissionMode, string]>
                ).map(([mode, label]) => ({
                  key: mode,
                  label,
                  selected: (harnessPrefs.permission ?? "bypass") === mode,
                  onSelect: () =>
                    setComposerHarnessPrefs(projectId, harness, {
                      permission: mode === "bypass" ? null : mode,
                    }),
                }))}
              />
              <div className="border-t border-rule-faint px-3.5 pb-1.5 pt-2">
                <div className="flex items-baseline justify-between">
                  <p className="text-xs font-medium text-label">Base</p>
                  <button
                    type="button"
                    disabled={refreshing}
                    onClick={() => void refreshBranches()}
                    className="font-mono text-[11px] text-faint transition-colors hover:text-foreground disabled:opacity-50"
                  >
                    {refreshing ? "fetching…" : "refresh"}
                  </button>
                </div>
                <input
                  value={base}
                  placeholder={project.defaultBranch}
                  onChange={(event) => setBase(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === "Escape") setMenu(null);
                  }}
                  className="mt-1.5 w-full rounded-lg border border-input bg-background px-2 py-1 font-mono text-[12px] text-foreground outline-none transition-colors placeholder:text-faint focus:border-[var(--sw-accent)]"
                />
              </div>
              {visibleBranches.length > 0 && (
                <MenuRadioGroup
                  mono
                  items={visibleBranches.map((branch) => ({
                    key: branch.name,
                    label: branch.name,
                    detail: branch.isDefault ? "default" : branch.sha.slice(0, 7),
                    selected:
                      base.trim() === branch.name || (base.trim() === "" && branch.isDefault),
                    onSelect: () => {
                      setBase(branch.isDefault ? "" : branch.name);
                      setMenu(null);
                    },
                  }))}
                />
              )}
            </>
          )}
        </ComposerMenu>
      )}
    </form>
  );
}

function ComposerPill({
  children,
  onClick,
  open,
  className = "",
}: {
  readonly children: React.ReactNode;
  readonly onClick: React.MouseEventHandler<HTMLButtonElement>;
  readonly open: boolean;
  readonly className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-7 max-w-56 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs transition-colors ${open ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"} ${className}`}
    >
      {children}
      <ChevronDown className="size-3 shrink-0 text-faint" />
    </button>
  );
}

/**
 * The pill popover — portaled to <body> (ancestor transforms would hijack
 * position:fixed) and clamped to the viewport, same mechanics as the
 * context menu. Radio rows close on select; the base input does not.
 */
function ComposerMenu({
  state,
  onClose,
  children,
}: {
  readonly state: MenuState;
  readonly onClose: () => void;
  readonly children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (panel === null) return;
    const rect = panel.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(state.anchor.left, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(state.anchor.bottom + 6, window.innerHeight - rect.height - 8)),
    });
  }, [state]);

  // Focus once the panel is visible — focus() on a visibility:hidden element
  // is silently ignored, and Escape needs the focus inside the overlay.
  useLayoutEffect(() => {
    if (position !== null) panelRef.current?.focus();
  }, [position]);

  return createPortal(
    <div
      className="fixed inset-0 z-50"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div
        ref={panelRef}
        role="menu"
        aria-orientation="vertical"
        tabIndex={-1}
        style={
          position ?? { left: state.anchor.left, top: state.anchor.bottom, visibility: "hidden" }
        }
        onClick={(event) => event.stopPropagation()}
        className="fixed min-w-[220px] max-w-[300px] rounded-xl border border-rule bg-popover py-1.5 shadow-[var(--shadow-overlay)] focus:outline-none"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

interface MenuRadioItem {
  readonly key: string;
  readonly label: string;
  /** Quiet mono id beside the label (e.g. a model id). */
  readonly detail?: string;
  readonly selected: boolean;
  readonly onSelect: () => void;
}

function MenuRadioGroup({
  label,
  mono = false,
  items,
}: {
  readonly label?: string | undefined;
  readonly mono?: boolean;
  readonly items: ReadonlyArray<MenuRadioItem>;
}) {
  return (
    <div className="not-first:mt-1 not-first:border-t not-first:border-rule-faint not-first:pt-1">
      {label !== undefined && (
        <p className="px-3.5 pb-1 pt-1.5 text-xs font-medium text-label">{label}</p>
      )}
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitemradio"
          aria-checked={item.selected}
          onClick={item.onSelect}
          className="flex w-full items-center gap-2 px-3.5 py-1.5 text-left transition-colors hover:bg-secondary"
        >
          <Check className={`size-3.5 shrink-0 ${item.selected ? "text-primary" : "invisible"}`} />
          <span
            className={`min-w-0 flex-1 truncate ${mono ? "font-mono text-[12px]" : "font-sans text-[13px]"} text-foreground`}
          >
            {item.label}
          </span>
          {item.detail !== undefined && (
            <span className="shrink-0 font-mono text-[11px] text-faint">{item.detail}</span>
          )}
        </button>
      ))}
    </div>
  );
}

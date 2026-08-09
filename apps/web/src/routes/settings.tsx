import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { AppShell } from "#/components/shell";
import {
  putSettings,
  sealantConnection,
  type SealantConnectionDto,
  type SettingsDto,
} from "#/lib/api";
import { queryClient, settingsQuery } from "#/lib/queries";
import { setThemePreference, useThemePreference, type ThemePreference } from "#/lib/theme";

export const Route = createFileRoute("/settings")({
  ssr: false,
  loader: async () => {
    await queryClient.ensureQueryData(settingsQuery);
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
        <ReviewAutomationPanel />
        <SealantConnectionPanel connection={connection} />
      </div>
    </AppShell>
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

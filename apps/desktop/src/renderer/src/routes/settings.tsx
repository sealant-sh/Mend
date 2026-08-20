import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import { Titlebar } from "#/components/titlebar";
import { appSettings, HARNESSES, useAppSettings } from "#/lib/app-settings";
import { useConnection } from "#/lib/connection";
import { queryClient } from "#/lib/queries";
import { DEFAULT_FAMILY, DEFAULT_SIZE, terminalFont, useTerminalFont } from "#/lib/terminal-font";
import { setThemeMode, useThemeMode, type ThemeMode } from "#/lib/theme";
import { isMonospaceFamily } from "#/terminal/ghostty/monospace-probe";

/**
 * Settings (BRIEF.md §settings): the terminal, appearance, workbench
 * defaults, the connection, and the keymap. Everything applies live and
 * persists per machine; nothing here writes to the server.
 */
export const Route = createFileRoute("/settings")({
  component: Settings,
});

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="w-full">
      <h2 className="mb-2 font-sans text-[12.5px] font-medium text-muted-foreground">{title}</h2>
      <div className="flex flex-col overflow-hidden rounded-2xl border border-rule bg-panel shadow-xs">
        {children}
      </div>
    </section>
  );
}

function RowShell({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 not-first:border-t not-first:border-rule">
      <div className="min-w-0 flex-1">
        <p className="font-sans text-[14px] text-foreground">{label}</p>
        {hint !== undefined && (
          <p className="mt-0.5 font-sans text-[12.5px] leading-relaxed text-label">{hint}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  readonly value: T;
  readonly options: ReadonlyArray<T>;
  readonly onChange: (next: T) => void;
}) {
  return (
    <div className="flex rounded-xl border border-rule bg-background p-0.5">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={option === value}
          className={`rounded-[10px] px-3 py-1 font-sans text-[13px] ${
            option === value
              ? "bg-panel font-medium text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

const input =
  "rounded-xl border border-[var(--sw-rule)] bg-background px-3 py-1.5 font-mono text-[13px] text-foreground outline-none placeholder:text-faint focus:border-[var(--sw-accent)]";

function TerminalSection() {
  const font = useTerminalFont();
  const [familyDraft, setFamilyDraft] = useState(font.family);
  const committed = familyDraft === font.family;
  const monospace = familyDraft.trim() === "" || isMonospaceFamily(familyDraft);

  const commitFamily = () => terminalFont.setFamily(familyDraft);

  return (
    <Section title="Terminal">
      <RowShell
        label="Font family"
        hint={
          monospace
            ? "any installed monospace face; empty resets to JetBrains Mono"
            : "measures as proportional — the terminal will fall back to its default stack"
        }
      >
        <input
          className={`${input} w-64 ${monospace ? "" : "border-[var(--sw-amber)]"}`}
          value={familyDraft}
          onChange={(event) => setFamilyDraft(event.target.value)}
          onBlur={commitFamily}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitFamily();
          }}
          placeholder={DEFAULT_FAMILY}
          spellCheck={false}
        />
        {!committed && <span className="font-sans text-[12px] text-label">enter to apply</span>}
      </RowShell>
      <RowShell label="Font size" hint="6–32px · Ctrl+Shift+= / − / 0 from anywhere">
        <button
          type="button"
          aria-label="Smaller"
          onClick={terminalFont.smaller}
          className="grid size-7 place-items-center rounded-lg border border-rule bg-background font-mono text-[14px] text-muted-foreground hover:text-foreground"
        >
          −
        </button>
        <span className="w-10 text-center font-mono text-[13.5px] text-foreground">
          {font.size}px
        </span>
        <button
          type="button"
          aria-label="Bigger"
          onClick={terminalFont.bigger}
          className="grid size-7 place-items-center rounded-lg border border-rule bg-background font-mono text-[14px] text-muted-foreground hover:text-foreground"
        >
          +
        </button>
        {font.size !== DEFAULT_SIZE && (
          <button
            type="button"
            onClick={terminalFont.reset}
            className="ml-1 font-sans text-[12px] text-label hover:text-foreground"
          >
            reset
          </button>
        )}
      </RowShell>
      <div className="border-t border-rule bg-term px-4 py-3">
        <p
          className="text-term-fg"
          style={{ fontFamily: `${font.family}, monospace`, fontSize: `${font.size}px` }}
        >
          mend › git log --oneline · 0O 1lI 5S 8B ~/.config
        </p>
      </div>
    </Section>
  );
}

function Settings() {
  const themeMode = useThemeMode();
  const settings = useAppSettings();
  const connection = useConnection();
  const [benchDraft, setBenchDraft] = useState(settings.benchCommand);

  return (
    <>
      <Titlebar liveCount={null} />
      <main className="min-h-0 flex-1 overflow-y-auto bg-canvas">
        <div className="mx-auto flex max-w-[640px] flex-col gap-6 px-6 py-10">
          <header className="flex items-end justify-between">
            <div>
              <p className="font-mono text-[11px] tracking-[0.57px] text-muted-foreground">
                MEND / SETTINGS
              </p>
              <h1 className="mt-1 font-display text-[24px] leading-tight font-medium text-foreground">
                Settings
              </h1>
            </div>
            <Link
              to="/"
              className="font-sans text-[13.5px] text-muted-foreground hover:text-foreground"
            >
              ← back to the cockpit
            </Link>
          </header>

          <TerminalSection />

          <Section title="Appearance">
            <RowShell
              label="Theme"
              hint="system follows the OS; the terminal stays dark either way"
            >
              <Segmented<ThemeMode>
                value={themeMode}
                options={["system", "light", "dark"]}
                onChange={setThemeMode}
              />
            </RowShell>
          </Section>

          <Section title="Workbench">
            <RowShell label="Default harness" hint="listed first in the launcher">
              <Segmented
                value={settings.defaultHarness}
                options={HARNESSES}
                onChange={appSettings.setDefaultHarness}
              />
            </RowShell>
            <RowShell
              label="Bench shell command"
              hint="empty follows the workspace image's login shell (zsh -l on a zsh image); applies to newly created benches"
            >
              <input
                className={`${input} w-64`}
                value={benchDraft}
                onChange={(event) => setBenchDraft(event.target.value)}
                onBlur={() => appSettings.setBenchCommand(benchDraft)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") appSettings.setBenchCommand(benchDraft);
                }}
                placeholder="workspace shell"
                spellCheck={false}
              />
            </RowShell>
          </Section>

          <Section title="Connection">
            <RowShell
              label={connection?.signedIn === true ? "Signed in" : "Not signed in"}
              hint={
                connection === null
                  ? ""
                  : `${connection.url} · credential shared with the mend CLI at ${connection.configPath}`
              }
            >
              <Link
                to="/connect"
                className="rounded-xl border border-rule bg-background px-3 py-1.5 font-sans text-[13px] text-foreground hover:bg-[var(--sw-sunken)]"
              >
                Manage
              </Link>
              {connection?.signedIn === true && (
                <button
                  type="button"
                  onClick={() => {
                    void window.mend.connection.signOut().then(() => {
                      queryClient.clear();
                      return null;
                    });
                  }}
                  className="font-sans text-[13px] text-muted-foreground hover:text-danger"
                >
                  Sign out
                </button>
              )}
            </RowShell>
          </Section>

          <Section title="Keyboard">
            <div className="px-4 py-3">
              <table className="w-full font-mono text-[12px]">
                <tbody>
                  {[
                    ["Ctrl+Shift+J / K", "next / previous session"],
                    ["Ctrl+Shift+H / L", "previous / next project"],
                    ["Ctrl+Shift+T / W", "new shell tab / close tab"],
                    ["Ctrl+Tab / +Shift", "next / previous tab"],
                    ["Ctrl+1…9", "jump to inbox row (hold Ctrl for pills)"],
                    ["Ctrl+Shift+P", "session palette"],
                    ["Ctrl+Shift+= / − / 0", "terminal font bigger / smaller / reset"],
                    ["Ctrl+,", "settings"],
                    ["Alt+Space", "summon the window (global)"],
                  ].map(([keys, action]) => (
                    <tr key={keys} className="not-first:border-t not-first:border-rule-faint">
                      <td className="py-1.5 pr-6 whitespace-nowrap text-foreground">{keys}</td>
                      <td className="py-1.5 font-sans text-[12.5px] text-label">{action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 font-sans text-[12px] text-faint">
                fixed for now — configurable later; Ctrl+K and Ctrl+T stay readline's
              </p>
            </div>
          </Section>
        </div>
      </main>
    </>
  );
}

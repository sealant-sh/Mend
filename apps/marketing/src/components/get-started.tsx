// THE WALKTHROUGH — one long page, eight numbered steps, from an empty
// machine to a reviewed change on a phone. Same type scale and rules as the
// home page; the words live here beside the layout because this page is only
// words, commands, and the space between them. No screenshots: every claim on
// this page is a command you can run.

import { Link } from "@tanstack/react-router";
import { Check, Copy } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Cmd, InstallCommand, PageHeader, REPO_URL } from "#/components/content";

export const GET_STARTED_TITLE = "From an empty machine to a reviewed change";
export const GET_STARTED_SUBLINE =
  "Eight steps. Install the CLI, set the server up on your own box, point your own agent at your own repository, read what it did, and carry it in your pocket.";

// ── page primitives ────────────────────────────────────────────────────────

/** A block of commands, mono on the sunken surface, with one copy affordance. */
function Snippet({ lines }: { readonly lines: ReadonlyArray<string> }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(lines.join("\n"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="mt-4 flex items-start gap-2 rounded-xl border border-rule bg-[var(--sw-sunken)] py-2.5 pr-2 pl-4 shadow-[var(--shadow-xs)]">
      <pre className="min-w-0 flex-1 overflow-x-auto py-0.5 font-mono text-[0.8rem] leading-[1.75] text-ink-2">
        {lines.map((line) => (
          <div key={line}>
            <span className="text-faint select-none">$ </span>
            {line}
          </div>
        ))}
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy commands"}
        className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--sw-wash)] hover:text-primary"
      >
        {copied ? (
          <Check className="size-4 text-success" aria-hidden="true" />
        ) : (
          <Copy className="size-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

/** Machine facts — a mono term and what it does, on hairlines, never boxes. */
function Facts({
  rows,
}: {
  readonly rows: ReadonlyArray<{ readonly term: string; readonly detail: ReactNode }>;
}) {
  return (
    <dl className="mt-4">
      {rows.map(({ term, detail }, i) => (
        <div
          key={term}
          className={`flex flex-col gap-1 py-2.5 sm:flex-row sm:gap-5 ${
            i === 0 ? "" : "border-t border-[var(--sw-faint-rule)]"
          }`}
        >
          <dt className="shrink-0 font-mono text-[12.5px] text-foreground sm:w-44">{term}</dt>
          <dd className="min-w-0 text-[14px] leading-relaxed text-muted-foreground">{detail}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A plain list of observations — a hairline-free stack, dashes not bullets. */
function Points({ items }: { readonly items: ReadonlyArray<ReactNode> }) {
  return (
    <ul className="mt-4 flex flex-col gap-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-[14.5px] leading-relaxed text-foreground/90">
          <span
            className="mt-[0.62em] size-1 shrink-0 rounded-full bg-[var(--sw-rule)]"
            aria-hidden="true"
          />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function P({ children }: { readonly children: ReactNode }) {
  return <p className="mt-4 text-[14.5px] leading-relaxed text-foreground/90">{children}</p>;
}

function Quiet({ children }: { readonly children: ReactNode }) {
  return <p className="mt-3 text-[14.5px] leading-relaxed text-muted-foreground">{children}</p>;
}

// ── the eight steps ────────────────────────────────────────────────────────

interface Step {
  readonly id: string;
  readonly label: string;
  readonly title: string;
  readonly body: ReactNode;
}

const STEPS: ReadonlyArray<Step> = [
  {
    id: "install",
    label: "Install",
    title: "Install Mend",
    body: (
      <>
        <P>
          Two commands, on the machine you want your agents to run on: install the CLI, then set the
          server up.
        </P>
        <div className="mt-4">
          <InstallCommand />
        </div>
        <Snippet lines={["mend server setup"]} />
        <P>
          The one-liner installs only the <Cmd>mend</Cmd> CLI, through npm;{" "}
          <Cmd>npm install -g @sealant/mend</Cmd> does the same. <Cmd>mend server setup</Cmd> then
          creates two containers on your Docker:
        </P>
        <Points
          items={[
            <>
              the Mend application — API, web app, and the Sealant workspace platform pinned inside
              it, so you pick one Mend version and nothing else
            </>,
            <>Postgres, with separate Mend and Sealant databases</>,
          ]}
        />
        <Quiet>
          When it finishes, the server answers at <Cmd>http://localhost:3105</Cmd>. Web and
          workspace SSH bind to localhost and Postgres publishes no port. Reaching it from another
          device is an explicit choice, in step 07. Repositories, worktrees, and the record live in
          Docker volumes.
        </Quiet>
        <p className="mt-7 text-xs font-medium text-label">Requirements</p>
        <Points
          items={[
            <>
              Node 22 or newer for the CLI. The <Cmd>mend</Cmd> dashboard needs 26; every other
              command runs on 22
            </>,
            <>Docker Engine, Docker Desktop, or OrbStack: the daemon running, with Compose v2</>,
            <>
              Linux is verified. macOS is being validated; the checklist is{" "}
              <a href={`${REPO_URL}/blob/main/docs/MACOS-VALIDATION.md`}>
                docs/MACOS-VALIDATION.md
              </a>
            </>,
          ]}
        />
        <p className="mt-7 text-xs font-medium text-label">Knobs</p>
        <Facts
          rows={[
            {
              term: "--version",
              detail: "Which Mend server to pin. A fresh setup pins the CLI's own version.",
            },
            { term: "--port", detail: "Where the web app listens. Default 3105." },
            { term: "--ssh-port", detail: "Where workspace SSH listens. Default 2222." },
            {
              term: "--bind, --url",
              detail: "Private-network exposure, together. Step 07 has the exact command.",
            },
          ]}
        />
        <Quiet>
          Re-running setup repairs rather than reinstalls: it keeps the pinned version, the secrets,
          and the volumes — and your data — alone.
        </Quiet>
      </>
    ),
  },
  {
    id: "account",
    label: "First account",
    title: "Create the first account",
    body: (
      <>
        <P>
          Open <Cmd>http://localhost:3105</Cmd> in a browser on that machine and sign up with an
          email and a password.
        </P>
        <P>
          The first account on a fresh install is yours — it owns the machine. Everything after it
          belongs to that account: projects, sessions, connected accounts, paired devices.
        </P>
        <P>
          Sign-up stays open after that: anyone who can reach the port can create another account on
          this instance, and an account can adopt repositories and start sessions on the box. Keep
          the machine on a network you control.
        </P>
        <Quiet>
          The account lives in the Postgres container on your box. No hosted identity, no
          third-party sign-in.
        </Quiet>
      </>
    ),
  },
  {
    id: "cli",
    label: "Sign in the CLI",
    title: "Sign the CLI in",
    body: (
      <>
        <P>The CLI talks to the same server as the browser, as the same account.</P>
        <Snippet lines={["mend login"]} />
        <Quiet>
          It opens the browser at the server's authorize page. Check that the code on the page
          matches the one in the terminal, press Authorize, and the CLI receives its own revocable
          device token, written with mode 0600 to <Cmd>~/.config/mend/cli.json</Cmd>. No password is
          typed into the terminal.
        </Quiet>
      </>
    ),
  },
  {
    id: "accounts",
    label: "Connect accounts",
    title: "Connect your agent accounts",
    body: (
      <>
        <P>
          Agents run inside Sealant workspaces, so they need your credentials there. One command per
          provider forwards this machine’s own credential file.
        </P>
        <Snippet lines={["mend connect claude", "mend connect codex", "mend connect github"]} />
        <Facts
          rows={[
            {
              term: "claude",
              detail: (
                <>
                  reads <Cmd>~/.claude/.credentials.json</Cmd>
                </>
              ),
            },
            {
              term: "codex",
              detail: (
                <>
                  reads <Cmd>~/.codex/auth.json</Cmd>
                </>
              ),
            },
            {
              term: "github",
              detail: (
                <>
                  reads the token from <Cmd>gh auth</Cmd>
                </>
              ),
            },
          ]}
        />
        <P>
          Mend ships no API keys and holds no pooled credit. Each person runs on their own
          subscription, under their own Sealant user.
        </P>
        <Quiet>
          <Cmd>mend accounts</Cmd> lists what is connected. The same list, with connect and
          disconnect, is in the web app under Settings → Connected accounts.
        </Quiet>
      </>
    ),
  },
  {
    id: "session",
    label: "First session",
    title: "Adopt a repository, start a session",
    body: (
      <>
        <P>From any checkout on the machine:</P>
        <Snippet lines={["cd ~/code/my-repo", 'mend claude "fix the flaky upload test"']} />
        <P>
          The first <Cmd>mend claude</Cmd> in a repository Mend has not seen adopts it from the
          checkout’s origin URL: Mend clones the repository into its own store and works there. Your
          checkout is never the execution target, and no local file is uploaded.
        </P>
        <p className="mt-7 text-xs font-medium text-label">What you just made</p>
        <Facts
          rows={[
            {
              term: "project",
              detail: "The repository, adopted into the machine’s central store.",
            },
            {
              term: "worktree",
              detail:
                "A durable named checkout in the store, on its own branch. It holds many sessions over its life.",
            },
            {
              term: "session",
              detail:
                "One supervised coding-agent conversation in that worktree, with its record. Bring your own harness — claude, codex, or any command.",
            },
            {
              term: "change",
              detail:
                "The worktree against its base, shared by every session inside it, reviewable from the first edit.",
            },
          ]}
        />
        <Quiet>
          <Cmd>mend codex</Cmd> and <Cmd>mend run -- &lt;cmd&gt;</Cmd> start the same kind of
          session with a different harness. <Cmd>mend adopt &lt;git-url&gt;</Cmd> adopts without
          starting one. <Cmd>mend sessions</Cmd> lists them; <Cmd>mend attach</Cmd> puts you back in
          a running one.
        </Quiet>
      </>
    ),
  },
  {
    id: "review",
    label: "Review",
    title: "Review the change",
    body: (
      <>
        <P>
          In the web app: Now → the session → its change. The diff sits beside the record — what the
          agent ran, and what came back.
        </P>
        <P>
          Mend reads the change and drafts comments and proposed checks. Each one links to the point
          in the record it came from, or ships a check you can run. Mend reports; you decide.
        </P>
        <P>
          Comments go back to the same session. Reply in the review and the agent picks it up in the
          worktree it is already standing in — the change continues rather than starting over.
        </P>
        <Quiet>
          Landing the change is a separate step, and optional: merge it, commit it, or open a pull
          request when you want one. Mend does not require a PR to exist.
        </Quiet>
      </>
    ),
  },
  {
    id: "phone",
    label: "Your phone",
    title: "Steer it from your phone",
    body: (
      <>
        <P>
          Pair once. In the web app: Settings → Devices → Pair a phone, which shows a QR code. Or,
          in a terminal on the machine:
        </P>
        <Snippet lines={["mend pair"]} />
        <P>
          The QR carries the instance URL and a single-use pairing code that expires after ten
          minutes. Claiming it mints a device token for that phone; Settings → Devices lists every
          paired device and revokes any of them.
        </P>
        <P>
          What claims it today is the native app in <Cmd>apps/mobile</Cmd>, an Expo project you
          build yourself — it is not on the App Store or Play, and there is no TestFlight build.
          Until it ships, the phone path that needs nothing installed is the web app: open the
          machine’s URL in the phone’s browser and sign in with the same account.
        </P>
        <Quiet>
          Manual entry works the same way as the QR: type the URL and the eight-character code shown
          next to it.
        </Quiet>
        <p className="mt-7 text-xs font-medium text-label">Reaching the machine</p>
        <P>
          The server binds to localhost until you say otherwise. To reach it from a phone, set it up
          with an explicit private address — a tailnet name is the short path, a LAN name works at
          home:
        </P>
        <Snippet
          lines={[
            "mend server setup --bind 0.0.0.0 --url http://mac-mini.local:3105 \\",
            "  --origin http://localhost:3105",
          ]}
        />
        <P>
          Pairing offers only the origins you configured; there is no interface guessing. Nothing
          here is an internet-facing setup: binding <Cmd>0.0.0.0</Cmd> opens every interface and
          sign-up stays open to whoever can reach it, so put the machine behind a tailnet or a
          firewall.
        </P>
      </>
    ),
  },
  {
    id: "operate",
    label: "Operate",
    title: "Operate it",
    body: (
      <>
        <p className="text-xs font-medium text-label">Check</p>
        <Snippet lines={["mend doctor"]} />
        <Quiet>
          A read-only checklist: the server, whether your token is accepted, the Sealant connection,
          each connected account, adopted projects, the <Cmd>claude</Cmd> / <Cmd>codex</Cmd> /{" "}
          <Cmd>gh</Cmd> CLIs on PATH, and the tailnet address. It changes nothing, and exits 1 when
          a line is a blocker.
        </Quiet>
        <p className="mt-7 text-xs font-medium text-label">Status, logs, restarts</p>
        <Snippet
          lines={["mend server status", "mend server logs --tail 100", "mend server restart"]}
        />
        <Quiet>
          <Cmd>mend server stop</Cmd> stops both containers and <Cmd>mend server start</Cmd> brings
          them back, on the same version and data. None of these delete a volume. Stop and restart
          interrupt connections; workspaces keep running, but active work may need to reconnect.
        </Quiet>
        <p className="mt-7 text-xs font-medium text-label">Upgrade</p>
        <Snippet lines={["mend server upgrade --version 0.24.0"]} />
        <Quiet>
          Updating the CLI never changes the server; the upgrade is its own explicit command. It
          validates the target image, stops the app, saves a private database dump, then activates
          the target and runs its migrations. Downgrades are refused, and nothing restores a
          database automatically — the dump is there for you.
        </Quiet>
        <p className="mt-7 text-xs font-medium text-label">Uninstall</p>
        <Quiet>
          There is no uninstall command yet. <Cmd>mend server stop</Cmd> stops both containers and
          keeps every volume. Removing the installation is a manual Docker operation on the{" "}
          <Cmd>mend</Cmd> Compose project and its volumes, plus <Cmd>~/.config/mend</Cmd>; do it
          only after backing up what you want to keep.
        </Quiet>
      </>
    ),
  },
];

const pad = (n: number) => `0${n}`.slice(-2);

// ── the page ───────────────────────────────────────────────────────────────

export function GetStartedPage() {
  return (
    <main className="relative flex min-h-dvh flex-col overflow-x-clip bg-[var(--sw-canvas)]">
      <div
        className="mend-dot-grid pointer-events-none absolute inset-x-0 top-0 h-[36rem] opacity-50 [mask-image:radial-gradient(ellipse_at_50%_0%,black,transparent_60%)]"
        aria-hidden="true"
      />

      <PageHeader getStarted={false} />

      <div className="relative mx-auto w-full max-w-[1200px] grow px-5 pt-8 pb-24 sm:px-8 sm:pt-12">
        <div className="grid gap-10 lg:grid-cols-[13rem_minmax(0,44rem)] lg:gap-16">
          {/* The index — mono, the recorder's voice, always in view. */}
          <nav aria-label="Steps" className="top-8 self-start max-lg:hidden lg:sticky">
            <p className="ev-eyebrow">walkthrough</p>
            <ul className="mt-3 flex flex-col">
              {STEPS.map((step, i) => (
                <li key={step.id}>
                  <a
                    href={`#${step.id}`}
                    className="flex gap-3 py-1.5 font-mono text-[12px] text-muted-foreground no-underline transition-colors duration-200 hover:text-foreground"
                  >
                    <span className="text-faint">{pad(i + 1)}</span>
                    <span className="min-w-0">{step.label}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-w-0">
            <header className="mend-rise">
              <p className="ev-eyebrow">get started</p>
              <h1 className="mt-2.5 font-display text-3xl leading-[1.08] font-semibold tracking-[-0.025em] text-balance text-foreground sm:text-4xl">
                {GET_STARTED_TITLE}
              </h1>
              <p className="mt-3.5 text-[15px] leading-relaxed text-muted-foreground">
                {GET_STARTED_SUBLINE}
              </p>
            </header>

            <div className="mt-14 flex flex-col">
              {STEPS.map((step, i) => (
                <section
                  key={step.id}
                  id={step.id}
                  className={
                    i === 0
                      ? ""
                      : "mt-16 border-t border-[var(--sw-soft-rule)] pt-16 sm:mt-20 sm:pt-20"
                  }
                >
                  <p className="font-mono text-xs text-faint">
                    {pad(i + 1)} / {pad(STEPS.length)}
                  </p>
                  <h2 className="mt-2.5 font-display text-2xl leading-snug font-semibold tracking-[-0.015em] text-foreground">
                    {step.title}
                  </h2>
                  <div className="[overflow-wrap:anywhere]">{step.body}</div>
                </section>
              ))}
            </div>

            <footer className="mt-20 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-[var(--sw-soft-rule)] pt-8">
              <Link
                to="/"
                className="font-sans text-[13px] font-medium text-muted-foreground no-underline transition-colors hover:text-foreground"
              >
                ← Back to the overview
              </Link>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="font-sans text-[13px] font-medium text-muted-foreground no-underline transition-colors hover:text-foreground"
              >
                Read the source
              </a>
              <p className="font-mono text-xs text-faint">open source · self-hosted</p>
            </footer>
          </div>
        </div>
      </div>
    </main>
  );
}

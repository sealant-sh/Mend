# @sealant/mend

## 0.10.1

### Patch Changes

- a421d71: Two protocol-session fixes, both diagnosed live on a Kubernetes deployment:
  - Claude sessions no longer show every assistant message twice. The stream-json CLI echoes each
    completed content block as its own `assistant` event whose content array holds just that block;
    the adapter keyed those echoes by array position (always 0), so with a thinking block at stream
    index 0 the completed text landed on the thinking block's item while the streamed deltas had
    already built the same text under its real id. The adapter now recovers the true stream index by
    counting consumed blocks per provider message id.
  - Resuming (or following up on) a stopped protocol session onto a fresh workspace now restores the
    harvested harness state before the harness starts. `launchProtocol` passed an explicit null
    state to `launchInternal` — the contract that skips both the read and the restore — while the
    composed argv still resumed by provider id, so `claude --resume` exited with "No conversation
    found". Deployments that reuse a retained workspace never saw this; fresh-workspace relaunches
    (Kubernetes, stopped workspaces) always did.

## 0.10.0

### Minor Changes

- 5930a45: `mend login` signs in through the browser instead of asking for a password. The CLI opens
  an authorize request against the server, points the browser at `<server>/authorize?code=…`, and
  polls until you press Authorize there. Approval mints a revocable device token, the same kind a
  paired phone holds. It shows up under Settings → Devices and replaces the old expiring session
  token, so the CLI no longer signs itself out when a browser session would have lapsed. A server
  that is already configured (`--url`, `MEND_URL`, or the config file) is used without asking; only
  a fresh machine with nothing set prompts for the URL, and Enter accepts the default. `--email` and
  the terminal password prompt are gone. `mend logout` now revokes the device server-side before
  forgetting the token locally.
- 8e71837: `mend service run` reaches the Service in one step. On a local server nothing changes:
  the command starts the Service and returns, and the bound endpoint already answers on this
  machine. On a remote server (a VPS, a Kubernetes Pod) the CLI now keeps running and tunnels the
  Service's port to `127.0.0.1` here — the same authenticated WebSocket `mend service connect` opens
  — instead of printing a suggestion to run a second command. Ctrl-C closes the tunnel, never the
  Service. `--no-connect` restores start-and-return. UDP Services are unchanged (no connection to
  tunnel).

  The server side of the tunnel is now authorized as well as authenticated: `/api/service-tunnel`
  refuses callers who are not the Service's session owner with 403.

- 00c683a: The dashboard is a drawn multi-pane workbench: projects and sessions panes side by side,
  a session detail panel beneath them, and the harness picker as a panel in the detail slot — no
  painted background, the terminal's own ground shows through, and chrome is near-mono with color
  only where it states a fact. Async state moved to optimistic mutations: starting or resuming a
  session puts a `starting` row in the list at the keystroke and leaves the keyboard free while the
  workspace provisions, renames land immediately, and review comment triage never waits on a round
  trip. The event stream is now parsed properly — heartbeats and per-record-line progress no longer
  refetch the workbench, so an idle dashboard makes no requests.

## 0.9.0

### Minor Changes

- eb2d1e3: Cluster bindings: a project can declare name-only references to Kubernetes Secrets and
  ConfigMaps (`mend env cluster add secret|configmap <name>`, `remove <kind>/<name>`) and a
  workspace ServiceAccount (`mend env cluster sa <name>` / `sa --clear`); `mend env show` lists them
  as a third section beside Configuration and Secrets. On a Kubernetes deployment the platform
  resolves the names inside the workspace at launch — Mend stores and forwards names, never the
  bound contents. Each session run records the binding names, revision, and service account it
  launched with; a binding or ServiceAccount change drains warm skeletons the same way an env or
  secret edit does. On a deployment that cannot resolve them, launch refuses readably, naming each
  binding, before any workspace is created (requires the platform SDK 0.24.0 surface). Also in this
  release: SessionRepository, the identity-keyed authority for session workspaces.

## 0.8.0

### Minor Changes

- d398efd: The server is now two processes: the Mend API server (`apps/api` — the typed contract,
  auth, the WebSocket data planes, the session engine, and the workers; port 3101,
  `MEND_MODE=all|api|worker`) and a stateless web server (`apps/web` — the TanStack app plus a
  transparent `/api` proxy carrying HTTP, SSE, and WebSocket upgrades; port 3105). Clients keep one
  origin and need no changes. The single-host installer and Docker image supervise both via
  `scripts/serve.mjs`; on Kubernetes the chart deploys them as separate tiers, and the web tier can
  be replicated.

## 0.7.1

### Patch Changes

- 0759bbf: Platform SDK 0.23.0: session attach, SSE output streams, and workspace port forwards now
  carry the owner assertion alongside a service key (Kubernetes deployments authenticate this way —
  attach and Service tunnels were rejected without it), and `workspaces.create` no longer pins the
  runtime family to Docker, so the deployment's default runtime decides.

## 0.7.0

### Minor Changes

- 5e1f3ce: `mend service connect [name…] [--port <n>]` brings live Services to THIS machine's
  loopback: each connection tunnels over one authenticated WebSocket to the server, which pumps it
  into the same workspace forward the server-side listener uses — works identically whether the
  server is your laptop, a VPS, or a Kubernetes Pod. Service status lines now lead with what your
  terminal can actually use (the tunnel on a remote server, the bind authority only on a local one),
  and Enter on an idle session in the dashboard opens a fresh shell in the held workspace instead of
  failing with "attach unavailable".

## 0.6.0

### Minor Changes

- 3f1eea2: Onboarding: `mend pair` prints a QR (and an eight-character code) that pairs a phone with
  this machine — the phone gets its own revocable device token, listed and revoked under Settings →
  Devices. `mend doctor` is a read-only checklist: server, sign-in, connected accounts, adopted
  projects, local harness CLIs, tailnet address — each failing line names the command that fixes it.
  `mend help` now opens with the getting-started sequence. A hidden `mend qr <text>` backs the
  installer's closing QR.
- e63ac2f: Each Mend user is their own Sealant user. Mend now authenticates to the control plane as
  a service principal (`SEALANT_SERVICE_KEY`; `SEALANT_OWNER_USER_ID` is gone) and provisions one
  Sealant user per account on first use, so sessions, records and model calls are attributed to the
  person who made them and run on that person's own connected accounts.
  - `mend connect claude|codex|github [--from-stdin] [--remove]` sends this machine's credential
    (the file the provider's CLI wrote at login, or a pasted one) to the platform under your own
    user; `mend accounts` lists what is connected. The Sealant web app is no longer needed.
  - Settings → Connected accounts does the same on web and desktop.
  - A hot-pool skeleton is claimed only by sessions of the user it was warmed for.

  Requires a control plane with service principals (`SEALANT_SERVICE_KEYS`, `POST /v1/users`).

## 0.5.0

### Minor Changes

- d60fc4b: Start a session with a prompt: `mend claude "fix the auth test"` opens the harness with
  the quoted prompt as its first message, and the session is named from it immediately instead of
  after the 45-second transcript poll. New flags on `mend claude|codex|opencode`: `--model <id>` and
  `--effort low|medium|high|xhigh|max` map to the harness's own model and reasoning flags,
  `--base <ref>` bases the worktree on a branch or sha, `--ask` restores the harness's permission
  prompts instead of the default bypass, and `--fast` requests priority processing (codex
  `service_tier=priority` — 1.5x speed at increased usage). The server composes the harness argv
  from the structured start, so the same launch path backs the web composer. Bare `mend claude` and
  `mend run -- <command...>` are unchanged.
- 196b2c7: Protocol-mode agent sessions: launch codex or claude as a structured byte protocol
  (`codex app-server`, claude stream-json) instead of a PTY. The conversation becomes rows Mend owns
  — authored turns, streamed items, and agent requests (approvals, questions) that block until a
  person answers — with new session endpoints to submit and interrupt turns, list items and requests
  by cursor, and respond to a pending request. A session with a live protocol agent reads `waiting`
  while a request is pending. PTY launches are unchanged and remain the default; protocol mode
  requires a workspace image with sealantd ≥ 0.11.

### Patch Changes

- 06beffc: The CLI now resolves the cwd's project the way you expect: a project adopted from GitHub
  matches any clone of the same remote (https, ssh, `.git` spellings compared equal), and the
  directory-name fallback goes through the same normalization `mend adopt` uses, so a checkout
  called `Mend` matches the project `mend`. Previously a GitHub-adopted project only matched when
  the folder name was spelled exactly like the store name, and `mend claude` from a mismatched
  folder would try to adopt the repository again. The guess is now visible:
  `mend claude|codex|opencode` print `✓ project mend · main · from cwd` before creating anything,
  and `mend projects` marks the cwd's project with `▸`.

## 0.4.0

### Minor Changes

- 6ed7b44: Hot sessions: a project can keep workspaces ready so new sessions attach instantly. Set
  the count on the project setup page (default 0) and Mend pre-provisions that many complete session
  skeletons — worktree, session socket, and a live workspace; starting a session claims one and goes
  straight to the terminal instead of paying the container build, dotfiles, and credential setup at
  launch. The pool drains and rewarms itself whenever the image, variables, secrets, references,
  mounts, or dotfiles change, and the setup page reports what is observed ("2 ready · 1 warming").
  Each ready workspace is a live container on this machine — the count is explicit resource intent.
  Resumes still launch cold: a resume is bound to its existing worktree, which a pooled workspace
  cannot adopt.

### Patch Changes

- ee0fd13: `mend dotfiles` shows the repository's subdirectory when one is set. The dotfiles
  repository knob now takes a repo-relative subdirectory: the launch archive is re-rooted there
  (`git archive HEAD:<subdirectory>`), so a repo whose home tree lives in a subfolder — a `dots/`
  directory, a stow package — applies to `~` without restructuring. Configured in Settings →
  Dotfiles.

## 0.3.1

### Patch Changes

- 0704527: `mend shell` sessions get the agent accounts you actually have. The shell workspace asked
  the platform for credential bundles (Claude + Codex + GitHub, then Claude + Codex, then GitHub)
  and fell back to none when any named account was not connected — a Codex-only user opened a shell
  with no agent auth at all. The ladder now degrades per provider, so a Codex-only (or Claude-only)
  user still lands on that account.

## 0.3.0

### Minor Changes

- 12f71f2: `mend env load [path]` — load a `.env` file into the project's environment store: every
  `KEY=VALUE` line becomes an entry (comments and blank lines dropped; `export` prefixes, quoted and
  multi-line values honoured), routed by name into Configuration or Secrets. Secret-shaped names
  (`*_KEY`, `*_TOKEN`, `*_SECRET`, `*_PASSWORD`, …) land in Secrets, as does everything when you
  pass `--secret` (or only the names in `--secret A,B`). Secrets are encrypted at rest and never
  printed back; the rest are plain Configuration. `mend env [show]` prints the current sets as terse
  facts — names, revisions, byte counts, never secret values. New workspace launches receive both
  sets (secrets through the platform's transient secret channel, redacted from the record); running
  sessions are unaffected.
- e7fa8de: `mend login [--url <server>]` signs the CLI in: it prompts for the email and password of
  your Mend account, exchanges them for a bearer token, and stores it (0600) in the CLI config next
  to the server url, so every other command is authenticated without setting `MEND_TOKEN`.
  `mend logout` clears it. Unauthenticated calls now say which server refused them and point at
  `mend login` instead of the bare "set MEND_TOKEN" hint.

## 0.2.0

### Minor Changes

- fefa161: `mend dotfiles` — your dotfiles on the server, captured from the machine that has them:
  `mend dotfiles sync [--all | paths…]` scans a curated candidate list (shell/git/editor/terminal
  configs — never keys or histories) on the calling machine and streams contents into your
  per-account dotfiles store; `mend dotfiles [show]` prints the store as terse facts. Sessions apply
  the snapshot before the agent starts. Also: the CLI config moves to
  `$XDG_CONFIG_HOME/mend/cli.json` (default `~/.config/mend/cli.json`); a pre-XDG `~/.mend/cli.json`
  keeps working when it is the only one present.

## 0.1.1

### Patch Changes

- d8f049c: Exit interactive CLI commands as soon as the session-end control frame arrives instead of
  waiting for the terminal transport and record finalization to close.

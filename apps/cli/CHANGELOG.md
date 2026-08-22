# @sealant/mend

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

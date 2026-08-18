# @sealant/mend

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

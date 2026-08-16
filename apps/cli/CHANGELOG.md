# @sealant/mend

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

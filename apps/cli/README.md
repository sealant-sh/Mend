# mend

The CLI for [Mend](https://github.com/sealant-sh/Mend) — a local-first workbench for developers who
use coding agents heavily. Adopt a repository into Mend's central store, run your agent (Claude
Code, Codex, or any command) in a recorded per-session git worktree, detach, and reattach from any
terminal.

```sh
npm install -g @sealant/mend
```

Requires Node 22+ and a running Mend server.

Run bare `mend` for the interactive dashboard. Highlight a session and press `v` to review its
accumulated change in the terminal: navigate files and hunks, switch between unified and split
diffs, add line or whole-change comments, inspect linked evidence, and draft a follow-up for the
same session. Press `o` when you want to continue the review in the web app.

## Commands

```
mend adopt [source] [--name <name>]   adopt a repository into the store (default: cwd)
mend codex|claude|opencode            new session worktree + launch the harness in it
mend run -- <command...>              same, with an arbitrary command
mend attach <session-id-prefix>       reattach this terminal to a running session
mend continue [session-id]            resume a session with its pending review follow-up
mend resume [session-id] [--with h]   rejoin a settled session (state restored; --with switches harness)
mend rejoin [session-id] [--harness h] attach if live, otherwise resume; newest live wins
mend sessions [--all] [--project p] [--json]
mend status                           active sessions (alias of mend sessions)
```

## Configuration

| Source             | What                                              |
| ------------------ | ------------------------------------------------- |
| `MEND_URL`         | The Mend server (default `http://localhost:3105`) |
| `MEND_TOKEN`       | Bearer token for that server                      |
| `MEND_DETACH_KEY`  | Set to `none` when an outer multiplexer detaches  |
| `~/.mend/cli.json` | `{ "url": ..., "token": ... }` — env vars win     |

## Herdr

When Mend attaches Codex, Claude Code, or OpenCode inside a Herdr pane, it reports that harness to
Herdr for the lifetime of the attachment. The session therefore appears in Herdr's Agents sidebar
whether it was started from the `mend` dashboard or a one-shot CLI command. Mend supplies Herdr's
foreground-process hint rather than claiming lifecycle authority, so Herdr continues to derive
working, idle, and blocked from its native agent screen rules.

## How it works

Every session runs in its own git worktree over the adopted repository, inside a recorded workspace.
The terminal you see is a held WebSocket to that workspace's PTY: `Ctrl+]` detaches and the session
keeps running; `mend attach` reconnects with full scrollback — from this machine or any other that
can reach the server. When a session settles, Mend harvests the harness's own state into the store,
so `mend resume` restores it natively (a Claude session resumes with its memory intact, even across
machines), and `--with` carries the conversation into a different harness.

The reviewable object is the session's accumulated local change — worktree versus base — with the
session record beside it. Review it in the terminal dashboard or the Mend web app. No issue tracker
or pull request required.

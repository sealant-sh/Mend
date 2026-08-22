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
diffs, reveal whitespace, select line ranges, add line or whole-change comments, inspect linked
evidence, and draft a follow-up for the same session. Press `y` to deliver a pending follow-up and
relaunch that session, or `o` to continue the review in the web app.

## Getting started

Once per machine, in this order:

```sh
mend login                       # sign in to the server; the token is saved 0600
mend connect codex               # send this machine's codex (or claude, github) credential
mend adopt                       # adopt the repository you are standing in
mend codex "fix the flaky test"  # new session worktree, harness running in it
mend pair                        # hand a phone the same server
mend doctor                      # every fact above, on one screen
```

`mend help` prints the same sequence under `start`, then everything else.

### mend pair

```
mend pair [--url <base url>]
```

Asks the server for a pairing code and prints it three ways: a QR of the `mend://pair` deep link,
the code grouped as `ABCD-EFGH`, and the base URL the device should reach — the machine's tailnet
address when it has one, otherwise a LAN address (`--url` overrides the choice). Scan it in the Mend
app, or type the URL and the code in by hand. The code is single use and expires in 10 minutes; the
device's own token is minted when it claims the code, and can be revoked from the Mend app later.
The device names itself when it claims the code.

### mend doctor

```
mend doctor
```

Reads, and changes nothing: server reachable, token accepted, the Sealant connection, each connected
account, adopted projects, the `claude` / `codex` / `gh` CLIs on PATH and whether their credentials
exist on this machine, and the tailnet address. One line per fact — `✓` observed, `○` not set up
yet, `✗` a blocker — and every line that needs an action ends with the one command that takes it:

```
✓ server      http://localhost:3105 · mend 0.5.0
✓ signed in   token accepted
✓ sealant     connected · http://127.0.0.1:4000
✓ claude      connected · you@example.com
○ codex       not connected → mend connect codex
✓ projects    2 adopted
○ gh cli      on PATH · no credential here → gh auth login
○ tailnet     not detected
```

It exits 1 when a `✗` is printed, so a setup script can gate on it. No request waits longer than 3s.

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
mend pair [--url <base url>]          pair a phone or a second machine: QR + code + URL
mend doctor                           read-only checklist of this machine's setup
```

## Signing in

```
mend login                 # asks for the email + password of your Mend account, saves a token
mend login --url https://mend.example.com --email you@example.com
mend logout
```

The token is stored 0600 in the CLI config below; every command uses it until `mend logout`. On a
dev instance with `MEND_STATIC_TOKEN` set, `MEND_TOKEN=<that value>` also works.

## Configuration

| Source                    | What                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `MEND_URL`                | The Mend server (default `http://localhost:3105`)                                         |
| `MEND_TOKEN`              | Bearer token for that server (normally written by `mend login`)                           |
| `MEND_DETACH_KEY`         | Set to `none` when an outer multiplexer detaches                                          |
| `~/.config/mend/cli.json` | `{ "url": ..., "token": ... }` — env vars win; a pre-XDG `~/.mend/cli.json` keeps working |

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

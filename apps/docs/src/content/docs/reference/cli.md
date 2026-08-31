---
title: CLI reference
description: Commands, flags, configuration, and terminal behavior for the Mend CLI.
sidebar:
  order: 1
---

The `mend` CLI talks to the Mend server. Run `mend help` for the help text installed with your
version. One-shot commands require Node 22 or newer. The terminal dashboard requires Node 26 and
`node:ffi`; every other command still works when the dashboard cannot start.

## Setup commands

| Command                                             | Purpose                                                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mend login [--url <server>]`                       | Sign in through the browser. The CLI opens `<server>/authorize`, waits for you to press Authorize, and saves a revocable device token with mode `0600` |
| `mend logout`                                       | Revoke this terminal's device token on the server and remove it from this machine                                                                      |
| `mend connect <provider> [--from-stdin] [--remove]` | Connect or remove `claude`, `codex`, or `github` for the signed-in user                                                                                |
| `mend accounts`                                     | List the signed-in user's connected provider accounts                                                                                                  |
| `mend doctor`                                       | Run a read-only setup checklist and print a repair command for unfinished items                                                                        |
| `mend pair [--url <base-url>]`                      | Create a single-use, ten-minute pairing code for another device                                                                                        |

Read [Connect provider accounts](/guides/provider-accounts/) for credential sources and removal.

## Project commands

| Command                                                    | Purpose                                                                    |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| `mend adopt [source] [--name <name>] [--auth <mode>]`      | Adopt a local path or Git URL into the store                               |
| `mend projects`                                            | List adopted projects and their live sessions                              |
| `mend env load [file] [--secret [A,B]] [--project <name>]` | Load dotenv values into project configuration and secrets                  |
| `mend env show [--project <name>]`                         | List configuration, secret, and cluster-binding names; never secret values |

Git authentication modes for `mend adopt` are `ambient`, `mend-key`, and `bridge`.

## Start agents and commands

```text
mend codex ["prompt"] [options]
mend claude ["prompt"] [options]
mend opencode ["prompt"] [options]
mend run -- <command...>
```

Agent options:

| Option                                   | Meaning                                                              |
| ---------------------------------------- | -------------------------------------------------------------------- |
| `--model <id>`                           | Pass a model selection to a supported harness                        |
| `--effort low\|medium\|high\|xhigh\|max` | Pass the reasoning effort                                            |
| `--base <ref>`                           | Create the worktree from another Git base                            |
| `--name <worktree>`                      | Name the worktree; an existing name joins it as a new session        |
| `--worktree <name>`                      | Join an existing worktree only — fails naming candidates when absent |
| `--ask`                                  | Restore the harness's permission prompts                             |
| `--fast`                                 | Request the Codex priority service tier                              |
| `--detach`, `-d`                         | Launch without attaching; reattach anywhere with `mend attach`       |
| `--foreground`                           | Stop the session when this CLI exits (the detach key still detaches) |
| `--project <name>`                       | Select an adopted project instead of matching the current directory  |

A quoted prompt becomes the first message and supplies the initial session name. Interactive
launches ask for the worktree's name first (enter accepts an automatic one); `--name` answers it up
front. The CLI creates or joins the worktree, says so when a name joins an existing one, waits for
the workspace and process, then attaches the current terminal. Requesting a `--base` that differs
from an existing worktree's base is refused rather than silently re-basing it.

### Background sessions

Sessions run in the background: closing the terminal, losing the network, or the CLI dying leaves
the session running, and stops are explicit. The `Sessions` switch in Settings (overridable per
project, `inherit · on · off`) turns this off for interactive launches, giving them foreground
semantics — the session stops when the launching `mend` exits. `--detach` and `--foreground`
override both for one launch. Foreground stops are best-effort on signals: a `SIGKILL` or power loss
cannot stop anything — `mend sessions` shows what still runs and `mend stop` ends it. The switch
applies to interactive CLI launches (`mend codex|claude|opencode`); `mend run` tails the record
without attaching, and browser or phone clients never stop a session by disconnecting.

Inside a session workspace, the staged helper accepts `mend stop` too, so a workspace shell (or the
agent itself) can end its own session.

Codex uses model, effort, permission, and speed options. Claude uses model, effort, and permission
options. OpenCode currently uses only the prompt; the other harness flags are accepted but ignored.

## Session commands

| Command                                                     | Purpose                                                        |
| ----------------------------------------------------------- | -------------------------------------------------------------- |
| `mend` or `mend ui`                                         | Open the terminal dashboard of projects and worktrees          |
| `mend worktrees [--project <name>] [--json]`                | List worktrees and the sessions inside them                    |
| `mend sessions [--all] [--project <name>] [--json]`         | List active sessions, or include settled sessions with `--all` |
| `mend status`                                               | Alias for the active-session list                              |
| `mend attach <session-id-prefix>`                           | Reattach to a running agent PTY                                |
| `mend stop <session-id-prefix> \| --all [--project <name>]` | Stop the agent — the record and review remain                  |
| `mend shell [session-id-prefix]`                            | Open a shell in a live session workspace                       |
| `mend continue [session-id]`                                | Resume a session with its pending review follow-up             |
| `mend resume [session-id] [--with <harness>]`               | Restore provider state and resume a settled session            |
| `mend rejoin [session-id] [--harness <harness>]`            | Attach when live, otherwise resume                             |

When no session ID is given, commands narrow candidates by the current project and then use an
interactive picker when needed.

`mend sessions --json` is the stable automation output (`"version": 1`, flat sessions) and does not
change shape. `mend sessions --json=v2` and `mend worktrees --json` emit the worktree-grouped
envelope (`"version": 2`); against an older server every session appears as its own worktree with
`"id": null`, so the shape is stable either way. Human-readable rows may change as the interface
improves.

Deleting a session removes only the conversation record; the worktree — with its change and
checkpoints — remains. Removing a worktree is its own explicit act (dashboard `Shift+D`, or the
API): refused while any session is live, and refused while an unreviewed change stands unless
forced.

## Dashboard keys

The dashboard groups sessions by worktree: a worktree with one session stays a single row, and a
shared worktree shows a header with its conversations underneath.

| Key             | On a session row                                      | On a worktree header                       |
| --------------- | ----------------------------------------------------- | ------------------------------------------ |
| `Enter`         | Attach, or resume when settled                        | Attach the newest live session, else start |
| `n`             | New worktree (name asked first)                       | Same                                       |
| `s`             | New session in this worktree                          | Same                                       |
| `x` / `Shift+K` | Stop the session (press twice)                        | Stop every live session (press twice)      |
| `Shift+D`       | Remove the worktree (press twice; refused while live) | Same                                       |
| `v`             | Review the worktree's change                          | Same                                       |
| `e`             | Rename the session label                              | —                                          |
| `o`             | Open in the browser                                   | —                                          |

## Terminal attachment

The CLI sends terminal input and resize events over one WebSocket and replays recorded output before
following live frames.

Press `Ctrl+]` to detach without stopping the process. Set:

```sh
export MEND_DETACH_KEY=none
```

when tmux, Zellij, or another outer tool owns detaching.

## Dotfiles commands

| Command                         | Purpose                                                 |
| ------------------------------- | ------------------------------------------------------- |
| `mend dotfiles`                 | Show the configured repository and synced file snapshot |
| `mend dotfiles sync`            | Preview known dotfile candidates on this machine        |
| `mend dotfiles sync --all`      | Replace the snapshot with all discovered candidates     |
| `mend dotfiles sync <paths...>` | Replace the snapshot with selected home-relative paths  |

Read [Dotfiles](/guides/dotfiles/) before syncing credentials or machine-specific files.

## Git key commands

| Command           | Purpose                                                             |
| ----------------- | ------------------------------------------------------------------- |
| `mend keys init`  | Generate the Mend machine's Ed25519 deploy key                      |
| `mend keys show`  | Print the public key and fingerprint                                |
| `mend keys share` | Relay this machine's SSH agent to the Mend server until interrupted |

The key bridge requires a reachable local SSH agent. Signing happens on the machine holding the key.

## Service commands

| Command                                                                       | Purpose                                                                     |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `mend service init [--yes]`                                                   | Scaffold `mend.toml` from package and Compose files                         |
| `mend service run [session] --port <port> [options] -- <command...>`          | Start and supervise a Service command; tunnels the port here when remote    |
| `mend service run [session] <name>`                                           | Start a recipe from `mend.toml`                                             |
| `mend service <name>`                                                         | Shorthand for a named recipe                                                |
| `mend service add [session] <port> [--name <name>] [--udp] [--http\|--https]` | Forward an existing workspace listener without supervising it               |
| `mend service connect [name...] [--port <port>]`                              | Bring live Services to this machine's loopback over an authenticated tunnel |
| `mend service list`                                                           | List live Services and observed endpoints                                   |
| `mend service logs <name-or-id> [--from <sequence>]`                          | Replay and follow recorded Service output                                   |
| `mend service restart <name-or-id>`                                           | Start another attempt for a supervised Service                              |
| `mend service stop <name-or-id>`                                              | Stop the process and close its host port                                    |

`mend service run` accepts `--name`, `--port`, `--udp`, `--http`, `--https`, and `--no-connect`.
Read [Development services](/guides/services/) for network and authentication boundaries.

### `mend` inside the workspace

Every session workspace has a `mend` command of its own on the PATH. It is not the CLI above and not
part of the workspace image: the server stages a small helper into the session's run directory,
mounted read-only at `/run/mend` and linked to `/usr/local/bin/mend`, so it is always version-locked
to the server. It talks only to its own session, over the session socket (or the authenticated
session endpoint on Kubernetes), and it speaks Services only:

| Command                                                               | Purpose                              |
| --------------------------------------------------------------------- | ------------------------------------ |
| `mend service` or `mend service list`                                 | List this session's live Services    |
| `mend service run --port <port> [--name <n>] [--udp] -- <command...>` | Start and supervise a Service        |
| `mend service run <name>` or `mend service <name>`                    | Start a recipe from `mend.toml`      |
| `mend service add <port> [--name <n>] [--udp]`                        | Adopt an existing workspace listener |
| `mend service stop <name-or-id>`                                      | Stop a Service                       |
| `mend service restart <name-or-id>`                                   | Start another attempt                |

The helper has no `--http`/`--https`, no `init`, no `logs`, and no `connect` — browser schemes,
history, and reaching the endpoint stay on your side. Its job is declaration: an agent that starts a
dev server can register it as a real Service instead of leaving an unobserved listener.

## Shell completion

```sh
mend completions zsh
mend completions bash
```

The generated hook completes command names and live session IDs. Add its output to the matching
shell configuration. Fish completion is not currently generated.

## CLI configuration

The CLI reads:

| Input                            | Default                                     |
| -------------------------------- | ------------------------------------------- |
| `MEND_URL`                       | `http://localhost:3105`                     |
| `MEND_TOKEN`                     | Saved token from the configuration file     |
| `MEND_DETACH_KEY`                | `Ctrl+]`                                    |
| `$XDG_CONFIG_HOME/mend/cli.json` | `~/.config/mend/cli.json` when XDG is unset |

The configuration file contains:

```json
{
  "url": "http://localhost:3105",
  "token": "<redacted>"
}
```

A legacy `~/.mend` directory remains authoritative when it is the only Mend configuration directory
on the machine.

## Exit behavior

One-shot commands print a readable server error and exit nonzero when a request fails. Interactive
commands return terminal control when the process ends or the user detaches. `mend doctor` does not
change server or machine state.

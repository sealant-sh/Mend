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

| Command                                             | Purpose                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------- |
| `mend login [--url <server>] [--email <address>]`   | Sign in with email and password and save the token with mode `0600`             |
| `mend logout`                                       | Remove the saved token from this machine                                        |
| `mend connect <provider> [--from-stdin] [--remove]` | Connect or remove `claude`, `codex`, or `github` for the signed-in user         |
| `mend accounts`                                     | List the signed-in user's connected provider accounts                           |
| `mend doctor`                                       | Run a read-only setup checklist and print a repair command for unfinished items |
| `mend pair [--url <base-url>]`                      | Create a single-use, ten-minute pairing code for another device                 |

Read [Connect provider accounts](/guides/provider-accounts/) for credential sources and removal.

## Project commands

| Command                                                    | Purpose                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| `mend adopt [source] [--name <name>] [--auth <mode>]`      | Adopt a local path or Git URL into the store                              |
| `mend projects`                                            | List adopted projects and their live sessions                             |
| `mend env load [file] [--secret [A,B]] [--project <name>]` | Load dotenv values into project configuration and secrets                 |
| `mend env show [--project <name>]`                         | List stored configuration and secret names without printing secret values |

Git authentication modes for `mend adopt` are `ambient`, `mend-key`, and `bridge`.

## Start agents and commands

```text
mend codex ["prompt"] [options]
mend claude ["prompt"] [options]
mend opencode ["prompt"] [options]
mend run -- <command...>
```

Agent options:

| Option                                   | Meaning                                                             |
| ---------------------------------------- | ------------------------------------------------------------------- |
| `--model <id>`                           | Pass a model selection to a supported harness                       |
| `--effort low\|medium\|high\|xhigh\|max` | Pass the reasoning effort                                           |
| `--base <ref>`                           | Create the session from another Git base                            |
| `--ask`                                  | Restore the harness's permission prompts                            |
| `--fast`                                 | Request the Codex priority service tier                             |
| `--project <name>`                       | Select an adopted project instead of matching the current directory |

A quoted prompt becomes the first message and supplies the initial session name. The CLI creates the
session worktree, waits for the workspace and process, then attaches the current terminal.

Codex uses model, effort, permission, and speed options. Claude uses model, effort, and permission
options. OpenCode currently uses only the prompt; the other harness flags are accepted but ignored.

## Session commands

| Command                                             | Purpose                                                        |
| --------------------------------------------------- | -------------------------------------------------------------- |
| `mend` or `mend ui`                                 | Open the terminal dashboard of projects and sessions           |
| `mend sessions [--all] [--project <name>] [--json]` | List active sessions, or include settled sessions with `--all` |
| `mend status`                                       | Alias for the active-session list                              |
| `mend attach <session-id-prefix>`                   | Reattach to a running agent PTY                                |
| `mend shell [session-id-prefix]`                    | Open a shell in a live session workspace                       |
| `mend continue [session-id]`                        | Resume a session with its pending review follow-up             |
| `mend resume [session-id] [--with <harness>]`       | Restore provider state and resume a settled session            |
| `mend rejoin [session-id] [--harness <harness>]`    | Attach when live, otherwise resume                             |

When no session ID is given, commands narrow candidates by the current project and then use an
interactive picker when needed.

`mend sessions --json` is the stable automation output. Human-readable rows may change as the
interface improves.

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
| `mend service run [session] --port <port> [options] -- <command...>`          | Start and supervise a Service command                                       |
| `mend service run [session] <name>`                                           | Start a recipe from `mend.toml`                                             |
| `mend service <name>`                                                         | Shorthand for a named recipe                                                |
| `mend service add [session] <port> [--name <name>] [--udp] [--http\|--https]` | Forward an existing workspace listener without supervising it               |
| `mend service connect [name...] [--port <port>]`                              | Bring live Services to this machine's loopback over an authenticated tunnel |
| `mend service list`                                                           | List live Services and observed endpoints                                   |
| `mend service logs <name-or-id> [--from <sequence>]`                          | Replay and follow recorded Service output                                   |
| `mend service restart <name-or-id>`                                           | Start another attempt for a supervised Service                              |
| `mend service stop <name-or-id>`                                              | Stop the process and close its host port                                    |

`mend service run` accepts `--name`, `--port`, `--udp`, `--http`, and `--https`. Read
[Development services](/guides/services/) for network and authentication boundaries.

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

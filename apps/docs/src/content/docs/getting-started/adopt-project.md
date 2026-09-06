---
title: Adopt a project
description: Clone a network Git repository into Mend's central store.
sidebar:
  order: 3
---

Adoption creates the Mend-owned repository used for sessions. Agents never run against your existing
checkout.

## Adopt the current repository

From a Git checkout:

```sh
mend adopt
```

Mend reads the checkout's `origin` URL and asks the server to clone that network repository. It does
not upload your local files or uncommitted changes. Without a network origin, supply a Git URL
explicitly.

Choose a name explicitly:

```sh
mend adopt --name billing-api
```

## Adopt another source

Supply a network Git URL:

```sh
mend adopt https://github.com/acme/api.git
mend adopt git@github.com:acme/api.git
mend adopt ssh://git@example.com/acme/api.git
```

The server performs the clone. Local paths, Windows paths, `file://` sources, and custom Git remote
helpers are rejected, even if the files exist on the server. There is no folder-adoption mode.

## Choose Git authentication

`--auth` selects how the Mend host authenticates remote Git operations:

| Mode       | Behavior                                                  |
| ---------- | --------------------------------------------------------- |
| `ambient`  | Use the Mend server account's existing Git and SSH setup  |
| `mend-key` | Use the machine's Mend-generated deploy key               |
| `bridge`   | Relay signing to an SSH agent shared from another machine |

Ambient mode is the default and uses credentials available inside the application container. It does
not inherit your laptop's home directory or SSH agent. Use a Mend key or a bridge when the container
has no credentials for your remote.

For a Mend key:

```sh
mend keys init
mend keys show
mend adopt git@github.com:acme/api.git --auth mend-key
```

Add the printed public key as a deploy key on the Git host before adoption. Grant write access only
if sessions should push.

For a hardware key that stays on your laptop, keep the bridge running there:

```sh
mend keys share
```

Then adopt with `--auth bridge`. The remote Mend host sends SSH signing requests back to the shared
agent. Press `Ctrl+C` to stop sharing.

## Store layout

Each project has a bare repository and its worktrees:

```text
<store>/<project>/repo.git
<store>/<project>/worktrees/<worktree>/
```

The store copy is canonical for Mend. Your previous checkout remains separate. Use normal Git
commits, fetches, and pushes to exchange work.

## Start the first session

After adoption:

```sh
mend codex
```

The CLI matches the current checkout to an adopted project by original path, remote URL, or project
name. Use `--project <name>` when you need to select one explicitly.

Read [Start a session](/getting-started/first-session/) for launch, detach, reattach, and resume
behavior.

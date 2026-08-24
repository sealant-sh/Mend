---
title: Adopt a project
description: Bring a local or remote Git repository into Mend's central store.
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

Mend finds the repository root, derives a project name, and clones it into the central store.

Choose a name explicitly:

```sh
mend adopt --name billing-api
```

## Adopt another source

The source can be a local path or any Git URL:

```sh
mend adopt /home/you/Developer/api
mend adopt https://github.com/acme/api.git
mend adopt git@github.com:acme/api.git
mend adopt ssh://git@example.com/acme/api.git
```

The server performs the clone. A local path must exist on the Mend machine, not only on the laptop
where the CLI runs.

## Choose Git authentication

`--auth` selects how the Mend host authenticates remote Git operations:

| Mode       | Behavior                                                  |
| ---------- | --------------------------------------------------------- |
| `ambient`  | Use the Mend server account's existing Git and SSH setup  |
| `mend-key` | Use the machine's Mend-generated deploy key               |
| `bridge`   | Relay signing to an SSH agent shared from another machine |

Ambient mode is the default. Verify the host first:

```sh
git ls-remote <source>
```

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

Each project has a bare repository and session worktrees:

```text
<store>/<project>/repo.git
<store>/<project>/worktrees/<session>/
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

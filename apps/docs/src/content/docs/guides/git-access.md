---
title: Git access
description: Choose how the Mend host authenticates clone, fetch, and push operations.
sidebar:
  order: 8
---

Remote Git operations belong to the Mend host. Session workspaces do not receive the host's SSH keys
or Git credentials.

A project chooses one authentication mode.

## Ambient credentials

Ambient mode uses the login user's existing Git and SSH setup on the Mend machine. It is the
default.

Verify access on that machine before adoption:

```sh
git ls-remote git@github.com:acme/api.git
```

Use ambient mode when the host already has the right SSH agent, key files, credential helper, or
GitHub CLI setup.

## Mend deploy key

Generate the machine's key:

```sh
mend keys init
mend keys show
```

Add the printed public key as a deploy key on the Git host, then adopt:

```sh
mend adopt git@github.com:acme/api.git --auth mend-key
```

The private key stays on the Mend host. Grant write access to the deploy key only when sessions need
to push.

## SSH-agent bridge

Bridge mode keeps the signing key on another machine. Start the relay where the SSH agent and key
are available:

```sh
mend keys share
```

Keep that command running, then choose bridge mode for the project:

```sh
mend adopt git@github.com:acme/api.git --auth bridge
```

Git transport bytes travel to the Mend host, while SSH signing requests travel back to the shared
agent. Hardware-key touch happens on the machine holding the key. `Ctrl+C` stops the relay.

## Git inside a workspace

Mend installs a `GIT_SSH_COMMAND` shim into the session workspace. Plain commands still work:

```sh
git fetch
git push
```

The shim carries the SSH transport over the session socket. The Mend host resolves the project's
current authentication mode and opens the remote connection. No SSH credential enters the container.

Mend records the remote operation and its outcome. Changing the project's auth mode applies to the
next Git operation without rebuilding the workspace.

## GitHub connected accounts are separate

`mend connect github` supplies a GitHub token to `gh` and compatible API clients inside workspaces.
It does not choose how the host clones, fetches, or pushes the repository.

Use [provider accounts](/guides/provider-accounts/) for GitHub API access. Use a project Git auth
mode for repository transport.

## Common failures

**Permission denied** means the selected host identity cannot access the remote. Test ambient
access, install the Mend public key, or verify that the shared agent contains an authorized key.

**Host key verification failed** means the Mend host does not trust the remote host key. Fix the
host's `known_hosts` entry. Do not disable host-key checking in a workspace.

**Bridge unavailable** means no signing client is connected. Restart `mend keys share` on the
machine holding the key.

---
title: Git access
description: Choose how the Mend host authenticates clone, fetch, and push operations.
sidebar:
  order: 8
---

Remote Git operations belong to the Mend host. Session workspaces do not receive the host's SSH keys
or Git credentials.

A project chooses one authentication mode. `mend keys mode` sets your default for new projects:
`mend-key` until you change it, or `bridge`. A project's setup page can override it, and
`mend adopt --auth` overrides it for one adoption.

## Ambient credentials

Ambient mode uses whatever Git and SSH setup exists where the Mend server process runs. In the
Docker deployment that is the application container, which ships no credentials and does not inherit
your laptop's home directory or SSH agent, so ambient mode reaches only public remotes there. It
fits a source checkout you run as your own user, where the host already has the right SSH agent, key
files, credential helper, or GitHub CLI setup.

Verify access where the server runs before adoption:

```sh
git ls-remote git@github.com:acme/api.git
```

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

**Host key verification failed** means the remote's host key changed since the Mend server first saw
it: every mode accepts a first-contact key and refuses a changed one. Verify the new key out of
band, then fix the `known_hosts` entry where the server's Git runs. Do not disable host-key checking
in a workspace.

**Bridge unavailable** means no signing client is connected. Restart `mend keys share` on the
machine holding the key.

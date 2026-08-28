---
title: Development services
description:
  What a Service is, how its bytes travel, and why it feels local without opening anything to a
  network.
sidebar:
  order: 7
---

A Service is a long-running process you declare on a session: the dev server, a database, Storybook.
It runs inside the session workspace, next to the agent and the worktree, and like every other
session process it keeps running when you disconnect. The declaration is the whole contract: Mend
never scans the workspace for listeners and never exposes anything you did not name.

## Opening the app

A workspace is a container with no published ports. When Vite listens on port 3000 in there, that
port exists only inside the container, and your machine cannot see it. So you declare it:

```sh
mend service run --port 3000 --http -- pnpm dev
```

Mend supervises the command, waits for port 3000 to answer, and hands you a local address like
`http://127.0.0.1:43127`. Open it. That is your app, hot reload and all, because Mend pipes raw
bytes and rewrites nothing.

Behind that address, Mend shuttles each connection through to the dev server:

```text
browser ──TCP──▶ Mend's listener on your laptop/host (:43127)
         ──WS───▶ Sealant API
         ──pipe─▶ sealantd, inside the container
         ──TCP──▶ Vite on 127.0.0.1:3000   (an ordinary local connect)
```

The dev server needs no configuration, no rebinding to `0.0.0.0`, no awareness that Mend exists.
From where it sits, a client connected from its own loopback.

Where the address lives is Mend's problem, not yours. When the server is the machine you sit at, the
listener is on it and the command returns. When the server is remote, the CLI stays running and
holds the address on your laptop instead, shuttling the bytes over the authenticated connection it
already has to the server, like an SSH tunnel you did not have to set up. Ctrl-C closes the tunnel,
not the Service, and only the session's owner can open one. Either way the app shows up at
`127.0.0.1` on the machine you are using, and the internet is never involved.

## Sharing it on your network

The local address serves you. When another device should open the app too, your phone or a
teammate's laptop on the same tailnet, an operator can bind the server-side listener to private
addresses the machine actually has, and those devices connect directly. Two rules keep this
contained: wildcards and public addresses are refused outright, so a Service cannot be published to
the internet through Mend, and the listener carries no Mend sign-in, so network reach is the gate
and the interface says so next to every endpoint.

UDP Services exist for the rare cases that need them; a datagram has no connection to tunnel, so
they always use the server-side listener.

## Declaring

A Service can be declared from three places, and they all feed the same model:

- **A recipe in `mend.toml`.** The repository's own declaration: every session can start `web` by
  name, and the recipe travels with the code.
- **The CLI**, wrapping the command you already run in `mend service run`.
- **The agent itself.** Each workspace has a scoped-down `mend` on its PATH that can run, adopt,
  list, stop, and restart Services for its own session. When the agent starts a dev server, it can
  declare it properly instead of leaving a listener nobody can reach. It cannot open ports or change
  exposure; that authority stays on the server.

A Service can also adopt a port that something else already listens on inside the workspace.
Adoption makes it reachable without supervision: there is no Mend-owned process to restart and no
log beyond what started it.

## Writing `mend.toml`

Recipes live in a `mend.toml` at the repository root, one table per Service:

```toml
[service.web]
command = "pnpm dev"
port = 3000
browserScheme = "http"

[service.db]
# no command: adopt a listener something else starts (a compose sidecar, a daemon)
port = 5432

[service.game]
command = "node server.js"
port = 9000
protocol = "udp"
```

The fields:

- `port` is the only required field: where the process listens inside the workspace, 1–65535.
- `command` is the shell command Mend supervises. Leave it out for an adopt-only recipe: Mend binds
  the listener but supervises nothing.
- `protocol` is `"tcp"` unless you say `"udp"`.
- `browserScheme` (`"http"` or `"https"`) is what gives a Service its Open action. TCP alone never
  implies HTTP, and a UDP recipe cannot declare one.

The table name is the lookup key (`mend service web`): lowercase letters and digits plus `.`, `_`,
and `-`, up to 64 characters.

Mend reads the file from the session's worktree, not from the project's main branch. Two things
follow. An agent can add a recipe as part of its change, and the addition reviews like any other
edit. And two sessions on different branches can carry different recipes. A malformed file is a
named error, never a guess; a missing file means no declared recipes. Recipes declared on the
project in the web app join the same set, and on a name collision the file wins, because it travels
with the code.

`mend service init` scaffolds the file from the package and Compose files it finds, and shows you
the result before writing it.

## Evidence, not promises

Every start is an attempt with a recorded log you can replay and then follow live. Restarting adds
another attempt under the same Service identity and endpoint, so history accumulates instead of
being replaced. Status words are observations: "reachable" means the declared target answered when
Mend checked, not a guarantee about the next request.

A live Service also keeps the session workspace retained after the agent settles, the same way a
detached shell does. Stopping the agent does not stop its Services; stop them when you are done, or
let them hold the workspace deliberately.

## Commands

The commands are few and listed once, in the [CLI reference](/reference/cli/#service-commands):
`mend service run`, `list`, `logs`, `restart`, `stop`, and `connect`, recipe scaffolding with
`mend service init`, and the in-workspace helper's smaller set.

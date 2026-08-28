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

## The problem it solves

A workspace is a container with no published ports. When Vite listens on port 3000 in there, that
port exists only inside the container's own network namespace. Your machine cannot see it, and
neither can anything else. A Service is Mend's answer to "then how do I open the app?", and the
answer is deliberately not "publish the port".

The bytes travel Mend's existing authenticated channels instead:

```text
browser ──TCP──▶ Mend's listener for this Service (:43127)
         ──WS───▶ Sealant API
         ──pipe─▶ sealantd, inside the container
         ──TCP──▶ Vite on 127.0.0.1:3000   (an ordinary local connect)
```

Only the first leg is a real network port. Everything after it rides the platform's channels: an
authenticated WebSocket from Mend to the Sealant control plane, the control pipe into the workspace,
and finally an ordinary local connect that your dev server experiences as a client on its own
loopback. The dev server needs no configuration, no rebinding to `0.0.0.0`, no awareness that Mend
exists.

Because the whole thing is a dumb byte pipe with no path rewriting and no proxy logic in between,
the app behaves exactly as it does locally: hot reload, WebSockets, cookies, everything.

## The one real port

The only real port is Mend's own listener: one per Service, bound from a fixed range (43100–43999 by
default). Where that listener lives is the only deployment-dependent question.

By default it binds the Mend machine's loopback. When Mend runs on the machine you sit at, the URL
just works, and nothing at all is on your network.

An operator can bind the listener to private addresses the machine actually has: a tailnet address,
a LAN address. Wildcards and public addresses are refused outright, so publishing a Service to the
internet through Mend is not possible, misconfigured or not. The listener carries no Mend sign-in;
network reach is its only gate, and the interface says so next to every endpoint.

Or the listener moves to your own laptop. The CLI binds the Service's port on your loopback and
carries each connection to the server over an authenticated WebSocket. On a remote server, starting
a Service does this automatically, so starting it and reaching it are one step. Unlike the raw
listener, every tunneled connection is authenticated, and only the session's owner may open one.

UDP Services exist for the rare cases that need them; a datagram has no connection to tunnel, so
they use the server-side listener only.

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

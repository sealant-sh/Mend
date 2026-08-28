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
browser ──TCP──▶ the doorway: Mend's listener for this Service (:43127)
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

## The doorway

The only real port is the doorway: one TCP listener per Service that Mend itself binds, from a fixed
range (43100–43999 by default). Where that doorway lives is the only deployment-dependent question
in the whole model.

By default it binds the Mend machine's loopback. When Mend runs on the machine you sit at, the URL
simply works, and nothing at all is on your network.

An operator can widen the doorway to private addresses the machine actually has: a tailnet address,
a LAN address. Wildcards and public addresses are refused outright, so publishing a Service to the
internet through Mend is not possible, misconfigured or not. The doorway itself carries no Mend
sign-in; network reach is its only gate, and the interface says so next to every endpoint.

Or the doorway moves to your own laptop. The CLI binds the Service's port on your loopback and
carries each connection to the server over an authenticated WebSocket. On a remote server, starting
a Service does this automatically, so starting it and reaching it are one step. Unlike the raw
doorway, every tunneled connection is authenticated, and only the session's owner may open one.

UDP Services exist for the rare cases that need them; a datagram has no connection to tunnel, so
they use the doorway path only.

## Declaring

Three surfaces feed the same model:

- **A recipe in `mend.toml`.** The repository's own declaration: every session can start `web` by
  name, and the recipe travels with the code.
- **The CLI**, wrapping the command you already run in `mend service run`.
- **The agent itself.** Each workspace has a scoped-down `mend` on its PATH that can run, adopt,
  list, stop, and restart Services for its own session. When the agent starts a dev server, it can
  declare it properly instead of leaving a listener nobody can reach. It cannot open ports or change
  exposure; that authority stays on the server.

A Service can also adopt a listener that already exists in the workspace. Adoption creates the
doorway without supervision: there is no Mend-owned process to restart and no log beyond what
started it.

## Evidence, not promises

Every start is an attempt with a recorded log you can replay and then follow live. Restarting adds
another attempt under the same Service identity and endpoint, so history accumulates instead of
being replaced. Status words are observations: "reachable" means the declared target answered when
Mend checked, not a guarantee about the next request.

A live Service also keeps the session workspace retained after the agent settles, the same way a
detached shell does. Stopping the agent does not stop its Services; stop them when you are done, or
let them hold the workspace deliberately.

## Commands

The command surface is small and listed once, in the
[CLI reference](/reference/cli/#service-commands): `mend service run`, `list`, `logs`, `restart`,
`stop`, and `connect`, recipe scaffolding with `mend service init`, and the in-workspace helper's
smaller surface.

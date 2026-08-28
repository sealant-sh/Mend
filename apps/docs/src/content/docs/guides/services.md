---
title: Development services
description: Run and reach development servers inside a Mend session workspace.
sidebar:
  order: 7
---

A Service is an explicitly declared process or port attached to a session. Use it for development
servers, databases, Storybook, or another long-running process that should remain reachable with the
session.

Services share the session workspace and worktree. They are not separate sessions.

## Run a command as a Service

```sh
mend service run --port 3000 --http -- pnpm dev
```

Useful options include:

- `--name <name>` for a stable display name;
- `--port <port>` for the workspace listener;
- `--http` or `--https` when the endpoint belongs in a browser;
- `--udp` for a UDP transport;
- `--no-connect` to start and return without opening the tunnel below.

Mend supervises the command, records its output, waits for the declared target, and opens a host
forward. It does not scan the workspace and expose listeners automatically.

When the Mend server is this machine, the command returns and the endpoint already answers locally.
When the server is remote, the CLI keeps running and tunnels the Service's port to `127.0.0.1` on
your machine — the same authenticated connection `mend service connect` opens — so starting a
Service and reaching it is one step everywhere. Ctrl-C ends the tunnel; the Service keeps running on
the server.

## Declare recipes in `mend.toml`

Scaffold recipes from common project files:

```sh
mend service init
```

Review the generated `mend.toml`, then start a named recipe:

```sh
mend service run web
```

The shorthand form is:

```sh
mend service web
```

A recipe belongs to the repository, so every session can use the same name and command.

## From inside the workspace

The workspace has its own `mend` on the PATH: a small helper the server stages into the session and
links to `/usr/local/bin/mend`, talking only to this session over the session socket. It speaks
`mend service run`, `add`, `list`, `stop`, and `restart`, plus the recipe shorthand — nothing else.
The point is that the agent can declare what it starts: a dev server the agent launches through
`mend service run` becomes a supervised, recorded, reachable Service exactly as if you had declared
it from outside, instead of an unobserved listener nobody can reach. The helper never opens ports
itself; the forward and its policy stay on the server.

## Adopt an existing listener

When a process is already listening inside the session workspace:

```sh
mend service add <session-id> 3000 --name web
```

This creates a forward but does not supervise the existing process. There is no Mend-owned command
to restart and no process log beyond the process that originally created it.

## Inspect and control Services

```sh
mend service list
mend service logs web
mend service restart web
mend service stop web
```

Logs replay recorded output and then follow it live. Restart starts another recorded attempt with
the same Service identity and endpoint. Stop ends the process and closes its host forward.

## Reach the endpoint

HTTP and HTTPS Services show an **Open** action. Other transports show an endpoint to copy.
WebSockets and hot reload work through the raw per-port forward because Mend does not rewrite paths
or proxy the application under a URL prefix.

The server's listener binds the **server's** interfaces. When the CLI and the server share a
machine, that endpoint is yours already. When the server is remote — a devbox, a VPS, or a
Kubernetes Pod — bring the port to your own machine instead:

```sh
mend service connect web --port 43100
```

`mend service connect [name...]` binds each selected Service on this machine's loopback and carries
every connection over an authenticated WebSocket to the Mend server. It works the same on every
deployment shape and adds Mend authentication to each connection. TCP only; keep it running like an
SSH tunnel. `mend service run` opens this tunnel automatically when the server is remote, so the
standalone command is for Services that are already running, or after a `--no-connect` start. The
tunnel serves only the Service's session owner; other authenticated users are refused.

The raw forwarded port itself has no Mend request authentication. Bind it only to loopback and
private interfaces you intend to expose. Anyone who can reach that port can talk directly to the
Service.

## Workspace lifetime

A live Service can keep the session workspace retained after the agent settles. Mend renews the
ordinary workspace lease while the Service, another supporting process, or a selected forward is
live.

Stopping the agent does not imply stopping every Service. Inspect the session before assuming its
workspace can be released.

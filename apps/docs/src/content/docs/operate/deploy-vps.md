---
title: Deploy on a VPS
description: Run Mend on a remote Linux host and work with it from your own devices.
sidebar:
  order: 1
---

A VPS or home server is the middle deployment tier: the same single-host install as
[your own machine](/getting-started/install/), plus the realities of the server not being the
machine you sit at. Run the installer on the VPS over SSH; everything on that page applies,
including Sealant — the workspace platform under Mend — which the installer sets up and manages on
the VPS for you. This page covers what changes when the server is remote.

## Reach the server privately

The Mend HTTP server listens on every interface so your devices can reach it, and sign-up stays open
— so the network is the boundary. Put the VPS on a private network you trust before anything else:

- **Tailscale (or another mesh VPN)** is the recommended shape: the server gets a stable private
  address, every device you enroll can reach it, and nothing is published to the internet.
- Without a mesh, use the provider's private networking or an SSH tunnel. Do not expose port `3105`
  publicly; plain HTTP on an untrusted network does not protect credentials.

Then point the CLI on your laptop at it:

```sh
mend login --url http://your-vps:3105
mend doctor
```

The CLI runs on your devices; the server runs the work. Every command in the docs behaves the same
with a remote `MEND_URL`.

## Connect providers from where the credentials live

`mend connect` reads provider credentials from the machine where you run it and sends them to the
server — so run it on your laptop, where `codex login`, `claude`, and `gh auth login` already
happened. Nothing needs to be logged in on the VPS itself.

```sh
mend connect codex
mend connect github
```

## Git authentication: ambient usually stops working

On your own machine, the default `ambient` mode borrows your existing SSH setup. A fresh VPS login
user has no such setup, so adoption over SSH remotes fails with permission or host-key errors.
Choose an explicit mode instead:

```sh
mend keys init                    # the server generates its own deploy key
mend keys show                    # add this as a deploy key on your Git host
mend adopt git@github.com:acme/api.git --auth mend-key
```

or keep your key on the laptop and relay signing:

```sh
mend keys share                   # keep running in a spare terminal
mend adopt git@github.com:acme/api.git --auth bridge
```

`mend-key` works unattended; `bridge` needs the relay running for every server-side Git operation.
Read [Git access](/guides/git-access/) for the full model.

## Reach development Services

A Service's host port binds on the **server**. From your laptop, bring it to your own loopback over
the authenticated tunnel:

```sh
mend service connect web --port 43100
curl http://127.0.0.1:43100
```

Alternatively, bind the server's private interface with `MEND_SERVICE_HOSTS` on the server and reach
the port directly over your private network — those ports carry no Mend authentication, so the
network is the gate. Read [Development services](/guides/services/).

## Pair phones and other devices

```sh
mend pair
```

The printed address must be reachable from the device — on a tailnet, that is the server's tailnet
address. Override it with `--url` when detection picks the wrong interface.

## Operate it

- **Upgrade** by rerunning the installer on the VPS; volumes survive.
- **Check** with `mend doctor` from any signed-in device.
- **Back up** the machine before version changes; a tested backup and restore procedure is not
  published yet.

When one host stops being enough — several users, more isolation, or cluster storage — the next tier
is [Deploy on Kubernetes](/operate/deploy-kubernetes/).

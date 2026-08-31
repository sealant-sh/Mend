---
title: Install Mend
description: Install the Mend server, CLI, and Sealant control plane on a Linux machine.
sidebar:
  order: 2
---

The installer sets up Mend and the Sealant control plane on a machine you control.

## Choose where Mend runs

Three deployment tiers, simple to complex. Start with the simplest one that fits:

| Tier                                                | Shape                          | Choose it when                                                              |
| --------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------- |
| **Your own machine** (this page)                    | Linux host with Docker, local  | You want the fastest start; server and terminal are the same machine        |
| [Deploy on a VPS](/operate/deploy-vps/)             | Same install, on a remote host | Sessions should keep running when your laptop sleeps; several devices       |
| [Deploy on Kubernetes](/operate/deploy-kubernetes/) | Helm charts on a cluster       | You already run a cluster and want cluster storage, policies, and isolation |

The two single-host tiers share this installer; the VPS page covers only what changes when the
server is remote. The rest of this page assumes the machine in front of you.

## What the installer runs

Two pieces land on the machine:

- **Mend** — the server you interact with: projects, sessions, review, the web UI on port `3105`.
- **Sealant** — the workspace platform underneath Mend. Sealant creates the isolated container
  workspaces where agents actually run, builds their images, supervises their processes, and keeps
  the durable record of what happened inside. It runs as a set of Docker containers bound to
  loopback.

You interact with Mend; Mend drives Sealant through its SDK. On the single-host tiers you never
install, configure, or upgrade Sealant separately — the installer owns both. (Kubernetes is the one
tier where you install Sealant yourself; its guide walks through that.)

## Requirements

You need:

- an x64 or arm64 Linux machine;
- Docker with a running daemon;
- Docker Compose 2.23.1 or newer;
- Git and `curl`;
- enough disk for adopted repositories, worktrees, workspace images, and databases;
- a private network you trust if another device will reach the server.

macOS support is not tested. The installer stops on macOS unless you set `MEND_ALLOW_MACOS=1`.

## Inspect the installer

Download and read it before running:

```sh
curl -fsSL https://mend.sealant.dev/install.sh -o /tmp/mend-install.sh
less /tmp/mend-install.sh
sh /tmp/mend-install.sh
```

The shorter form is:

```sh
curl -fsSL https://mend.sealant.dev/install.sh | sh
```

The installer does not need `sudo`. It installs the CLI, creates a user service for the Mend server,
and starts the Sealant control-plane containers.

## Network boundary

Postgres and the Sealant control plane bind to loopback. The Mend HTTP server listens on every
interface in the current installer shape so browsers and devices on the host's LAN or tailnet can
reach it.

> **Keep the instance private.** Sign-up remains open after the first account. Anyone who can reach
> the Mend server can create an account. The default install does not add HTTPS or account-level
> isolation for project data.

Use a private network such as Tailscale. Do not expose port `3105` directly to the public internet.

## Create your Mend account

Open:

```text
http://localhost:3105
```

Create an account, then sign the CLI in:

```sh
mend login
```

For a remote host:

```sh
mend login --url http://mend-host:3105
```

`mend login` opens the browser at `<server>/authorize` and waits. Check that the code on the page
matches the one in the terminal, then press **Authorize**. No password is typed into the terminal;
the CLI receives a device token of its own, revocable any time under Settings → Devices. The URL and
token land in `~/.config/mend/cli.json` with file mode `0600`.

## Connect providers

Connect only the providers you use:

```sh
mend connect claude
mend connect codex
mend connect github
mend accounts
```

Signing in to Mend and connecting a provider are separate operations. Read
[Connect provider accounts](/guides/provider-accounts/) for local credential sources, standard-input
setup, replacement, and removal.

## Check the installation

```sh
mend doctor
```

Doctor checks server health, the saved token, the Sealant connection, connected accounts, adopted
projects, local provider CLIs, local credentials, and the detected tailnet address. Setup tasks are
reported separately from failures.

## Repair an installation

Running the installer again repairs files and services while leaving existing volumes in place:

```sh
sh /tmp/mend-install.sh
```

You can request current release tags:

```sh
MEND_VERSION=latest SEALANT_VERSION=latest sh /tmp/mend-install.sh
```

Mend does not yet publish a tested backup, rollback, and version-compatibility procedure. Treat a
version change as an operator action, back up the machine first, and inspect release notes before
upgrading.

The [`install.sh` source](https://github.com/sealant-sh/mend/blob/main/install.sh) documents ports,
paths, version overrides, and dry-run options.

## Next steps

1. [Connect provider accounts](/guides/provider-accounts/).
2. [Adopt a project](/getting-started/adopt-project/).
3. [Configure its session environment](/guides/project-environment/).
4. [Start a session](/getting-started/first-session/).

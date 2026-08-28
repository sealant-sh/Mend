---
title: Feature status
description: Separate implemented Mend behavior from planned product work.
sidebar:
  order: 1
---

Mend is under active development. This page describes the current repository, not a promise about a
published release. Run `mend doctor` and check your installed versions before following a guide.

## Implemented in the current repository

| Area                | Current behavior                                                                  |
| ------------------- | --------------------------------------------------------------------------------- |
| Project store       | Adopt local paths and Git URLs into a bare repository owned by Mend               |
| Session worktrees   | Create one branch and worktree per session                                        |
| Agents              | Launch Codex, Claude Code, OpenCode, and arbitrary commands                       |
| Session processes   | Run PTY agents, protocol agents, shells, and Services in one session workspace    |
| Reattachment        | Detach and replay terminal output from CLI, web, desktop, and mobile clients      |
| Workspace images    | Managed Arch, Ubuntu, Fedora, and Nix families plus custom OCI bases              |
| Project environment | Plaintext configuration, encrypted write-only secrets, `.env` import              |
| Cluster bindings    | Store, API, Setup panel, and `mend env show` for named cluster Secrets/ConfigMaps |
| Identity            | Per-user Claude, Codex, and GitHub connected accounts                             |
| Dotfiles            | Repository-backed setup and home-file snapshots per user                          |
| Extra inputs        | Read-only references and per-project host-folder mounts                           |
| Services            | Explicit supervision, raw TCP/UDP host forwards, authenticated client tunnels     |
| Hot sessions        | Pre-provisioned worktrees and workspaces keyed by launch-input fingerprints       |
| Git access          | Ambient host auth, Mend deploy keys, SSH-agent bridge, workspace transport shim   |
| Remote access       | Browser access, device pairing, bearer revocation, private-network candidate URLs |
| Change review       | Worktree-versus-base diffs, checkpoints, comments, tours, suggestions, follow-ups |
| Kubernetes          | Helm chart, network session channel, and cluster workspaces via the Sealant chart |

Some implemented paths still need release-level acceptance tests. The operational guides state known
boundaries where that matters.

## Planned or incomplete

| Area                        | Status                                                          |
| --------------------------- | --------------------------------------------------------------- |
| Cluster binding launches    | Declaring bindings is gated until the platform resolves them    |
| Context items and packs     | Planned; no public library or selection workflow                |
| Immutable context snapshots | Schema exists, but session provisioning does not attach one     |
| Editable handoffs           | Planned                                                         |
| Published native mobile app | Source exists; no supported distribution path                   |
| Scoped device permissions   | Planned; current paired tokens have normal authenticated access |
| Automatic listener exposure | Not planned; Services remain explicit                           |
| Public internet ingress     | Not a default goal; use a private network                       |
| Tested backup and restore   | Not yet documented as a supported procedure                     |
| Tested rollback             | Not yet documented as a supported procedure                     |
| Automatic merge decisions   | Explicitly outside the product model                            |

## Canonical sources

- [`MEND-AGENT-WORKBENCH-PLAN.md`](https://github.com/sealant-sh/mend/blob/main/MEND-AGENT-WORKBENCH-PLAN.md)
  owns product direction and decisions.
- [`PLATFORM-FEEDBACK.md`](https://github.com/sealant-sh/mend/blob/main/PLATFORM-FEEDBACK.md) owns
  gaps between Mend and the public Sealant SDK.
- The implementation and its tests determine whether a current command or UI path exists.

A plan milestone is not release status. A platform feature marked implemented at its source is not
available to Mend until a released SDK is installed and Mend adopts it.

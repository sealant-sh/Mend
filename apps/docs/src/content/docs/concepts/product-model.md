---
title: Product model
description: The machines, projects, sessions, workspaces, processes, and changes that make up Mend.
sidebar:
  order: 2
---

Mend organizes work around a project on a machine you control. Issues and pull requests are optional
references, not the identity of the work.

```text
Machine
└── Project
    ├── Project setup
    ├── Sessions
    │   ├── Worktree
    │   ├── Agent, shell, and Service processes
    │   └── Durable records
    └── Changes
```

## Current model

### Machine

A machine runs Mend and Sealant. It may be your laptop, a home server, or a remote devbox reached
over a private network. It owns the project store and launches session workspaces.

### Project

A project is a Git repository adopted into Mend's central store. The store has a bare repository and
one worktree for each session. Mend treats a previous checkout as a Git peer, not as an execution
target.

A project also owns the setup used by future workspaces: image, variables, secrets, references,
mounts, Services, dotfile policy, hot-session count, Git access, and automation switches.

### Session

A session is one supervised coding-agent conversation associated with one project and one worktree.
It remains the same Mend session when an agent settles and later resumes.

A session can contain several agent processes over its life. Supporting shells and Services belong
to the same session because they can read or change its worktree.

### Process

A process is one running or settled interaction with a session workspace. Current process kinds are:

- `agent-pty` for an interactive agent terminal;
- `agent-protocol` for a structured provider adapter;
- `shell` for a supporting terminal;
- `service` for a declared development process.

Process state and session state are separate. A settled agent can leave a workspace retained by a
shell or Service.

### Workspace

A workspace is the Sealant environment where session processes run. Mend creates it over the session
worktree and resolves the image, environment, secrets, mounts, accounts, and dotfiles at creation.

The workspace is an execution environment. The session is the longer-lived product object.

### Change

A change is a repository comparison. The main comparison is the session worktree against its base.
It does not require a commit, issue, or pull request.

### Checkpoint

A checkpoint is a hidden Git ref paired with observed positions in the session's process records.
Any two checkpoints define a reviewable slice: Git supplies the comparison, and the record positions
bound what Mend had observed.

### Service

A Service is a stable, explicitly declared development process or forwarded port associated with a
session. It retains its process-attempt history and endpoint while individual attempts restart.

## Planned context model

The schemas contain an early context-snapshot shape, but current session provisioning does not
create or attach operational context packs or snapshots.

The product direction defines:

- a **context item** for a file, document, note, URL, external reference, or previous handoff;
- a **context pack** as an editable named selection for recurring work;
- a **context snapshot** as the immutable selection supplied to one session;
- a **handoff** as an editable end-of-session summary promoted into durable context.

Read [Context](/concepts/context/) for what sessions can receive today.

## Publication

Publication is optional output from a useful local session. The product direction includes commit
and pull-request creation, but those actions do not define projects, sessions, or changes.

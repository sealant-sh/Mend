---
title: Product model
description:
  The machines, projects, worktrees, sessions, workspaces, processes, and changes that make up Mend.
sidebar:
  order: 2
---

Mend organizes work around a project on a machine you control. Issues and pull requests are optional
references, not the identity of the work.

```text
Machine
└── Project
    ├── Project setup
    └── Worktrees
        ├── Sessions
        │   ├── Agent, shell, and Service processes
        │   └── Durable records
        ├── Checkpoints
        └── Change
```

## Current model

### Machine

A machine runs Mend and Sealant. It may be your laptop, a home server, or a remote devbox reached
over a private network. It owns the project store and launches session workspaces.

### Project

A project is a Git repository adopted into Mend's central store. The store has a bare repository and
one directory per worktree. Mend treats a previous checkout as a Git peer, not as an execution
target.

A project also owns the setup used by future workspaces: image, variables, secrets, references,
mounts, Services, dotfile policy, hot-session count, Git access, and automation switches.

### Worktree

A worktree is a durable named place in the project store: its own checkout on its own branch,
created from a chosen base. It owns the change, the checkpoint chain, and their review, and it
outlives every conversation inside it. Removing a worktree is its own explicit act — it is refused
while any session is live, and deleting a session never removes the worktree.

Starting a session with a worktree name that already exists joins that worktree as a new
conversation; requesting a different base for an existing worktree is refused rather than silently
re-basing it.

### Session

A session is one supervised coding-agent conversation inside a worktree. A worktree holds many
sessions over its life, and several can be live at once. A session remains the same Mend session
when an agent settles and later resumes.

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

A workspace is the Sealant environment where session processes run. Mend creates it over the
session's worktree and resolves the image, environment, secrets, mounts, accounts, and dotfiles at
creation. Each session has its own workspace; concurrent sessions in one worktree mount the same
files.

The workspace is an execution environment. The session is the longer-lived product object.

### Change

A change is a repository comparison. The main comparison is the worktree against its base — one
change per worktree, and every conversation inside the worktree contributes to it. It does not
require a commit, issue, or pull request.

### Checkpoint

A checkpoint is a hidden Git ref paired with observed positions in the process records. The chain
belongs to the worktree: one ordered sequence across every conversation in it, and any two
checkpoints define a reviewable slice — even when different sessions took them. Git supplies the
comparison, and the record positions bound what Mend had observed.

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

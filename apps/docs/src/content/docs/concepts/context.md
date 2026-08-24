---
title: Context
description: Understand what session context exists today and what Mend plans to add.
sidebar:
  order: 3
---

Mend's product direction puts project context beside agent sessions and worktrees. The complete
context-pack workflow is not shipped yet, so this page separates current inputs from planned work.

## Available now

A session can start with information and resources that already belong to the project or user:

- repository files and instructions such as `AGENTS.md`;
- read-only reference repositories mounted under `/workspace/ref/<name>`;
- extra host folders mounted under `/workspace/home/<name>`;
- project configuration variables and secrets;
- personal provider accounts and dotfiles;
- the previous process record and provider state when a session resumes.

Mend records the workspace and repository state used for the session where the current contracts
allow it. These inputs are configuration and mounted resources. They are not yet a named, versioned
context pack.

## Planned context workflow

The canonical product plan defines four additions:

1. A **context item** points to a file, document, note, URL, issue, pull request, or previous
   handoff.
2. A **context pack** is an editable named selection of those items for recurring work.
3. A **context snapshot** freezes the exact selection supplied to one session.
4. A **handoff** turns the end of a session into editable context for later work.

A future session will receive an immutable snapshot even when the reusable pack changes later. That
will make the question "what did this agent know?" answerable from the session itself.

## What not to assume

Mend does not currently provide automatic long-term memory, hidden context selection, or a context
library in the public product. Do not rely on those features until the UI, storage, and session
attachment path ship.

For current work, keep durable instructions in the repository, configure explicit references and
mounts, and use the session record when resuming related work.

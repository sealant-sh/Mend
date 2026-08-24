---
title: Product language
description: Use Mend's product nouns and factual status language consistently.
sidebar:
  order: 3
---

Use these terms in the interface, documentation, and support material.

| Term                 | Availability | Meaning                                                                   |
| -------------------- | ------------ | ------------------------------------------------------------------------- |
| **Machine**          | Current      | A developer-controlled computer or devbox running Mend and Sealant        |
| **Project**          | Current      | A repository adopted into Mend's central store                            |
| **Session**          | Current      | One supervised coding-agent conversation, worktree, and durable record    |
| **Process**          | Current      | One agent, shell, or Service execution that belongs to a session          |
| **Change**           | Current      | A repository comparison, usually the session worktree against its base    |
| **Checkpoint**       | Current      | A hidden Git snapshot paired with observed process-record positions       |
| **Service**          | Current      | An explicitly declared development process or forwarded port in a session |
| **Context item**     | Planned      | A file, document, note, URL, external reference, or previous handoff      |
| **Context pack**     | Planned      | An editable selection of context items for recurring work                 |
| **Context snapshot** | Planned      | The immutable context supplied to one session                             |
| **Handoff**          | Planned      | An editable session summary promoted into durable context                 |
| **Workspace**        | Sealant      | The environment where session processes run                               |
| **Run**              | Sealant      | A process execution with a durable platform record                        |
| **Harness**          | Sealant      | Codex, Claude Code, or another agent command that Mend supervises         |

Do not call a process a session. A session can contain several agent processes over time plus
supporting shells and Services.

## Describe status as observation

Use factual states such as:

- running;
- waiting;
- idle;
- completed;
- failed;
- stopped;
- observed;
- not executed;
- attribution unknown.

Do not write "safe to merge," "low risk," "high confidence," or another judgment that belongs to the
developer.

## Describe inference plainly

Inference has no product noun. Write "Mend uses inference" or "Mend reads the change."
Machine-generated findings are draft comments and proposed checks, never approval or a verdict.

Every finding must link to the session record or include a runnable check that could test it.

## Keep publication optional

Issues and pull requests are optional references. Do not frame an issue, queue item, branch, or pull
request as the identity of the work. A developer should receive value while the change remains local
and uncommitted.

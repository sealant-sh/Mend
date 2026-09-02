---
"@sealant/mend": minor
---

Hot sessions are standby workspaces. A pooled workspace no longer pre-creates a worktree: it mounts
the project's worktrees directory and the session that claims it binds its own worktree at launch,
so the pool now serves a named join into an existing worktree as well as a brand-new one, and a
skeleton never spends a worktree or a worktree row ahead of time. Every session's workspace is
created this way (Sealant 0.26, sealantd 0.13), which is also what lets a project mount sibling
repositories next. Migration 0048 relaxes the pool's worktree columns.

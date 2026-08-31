---
"@sealant/mend": patch
---

The dashboard's new-worktree flow gains a base picker between the name and the harness: a fuzzy
finder over the project's branches (type to filter, ↑↓ to move, enter to choose; the default branch
leads an empty query and stays the base when you just press enter). Joining an existing worktree
skips it — that base is already fixed. An unreadable branch list falls back to the default base
instead of blocking the launch.

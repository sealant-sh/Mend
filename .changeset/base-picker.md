---
"@sealant/mend": patch
---

Worktree creation in the dashboard is one modal: name, base, and harness as visible steps — enter
advances, esc steps back (cancelling from the name). The base step is a fuzzy finder over the
project's branches (type to filter, ↑↓ to move; the default branch leads an empty query and plain
enter keeps it). A name that joins an existing worktree skips the base — it is fixed — and an
unreadable branch list falls back to the default instead of blocking the launch.

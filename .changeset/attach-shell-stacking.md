---
"@sealant/mend": patch
---

Entering a session whose agent terminal has ended now rejoins the shell already holding the
workspace instead of opening a fresh bash per attempt — the failure mode where Ctrl+C out of an
agent left a session held open by a stack of orphan shells. Stops and worktree removals in the
dashboard paint optimistically: the row settles (its live process and service fact lines drop with
it) or leaves the list before the server answers, and an error refetches truth.

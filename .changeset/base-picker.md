---
"@sealant/mend": patch
---

Worktree creation in the dashboard is one floating, fixed-size modal: name, base, and harness all
visible at once — enter or tab advances (shift+tab and esc step back; esc cancels from the name),
nothing shifts as focus moves. The base step is a fuzzy finder over the project's branches,
prefilled with the branch checked out where `mend` ran when creating in that project; a name that
joins an existing worktree shows the base as fixed. Running `mend` inside a repo the store doesn't
know raises an adopt offer: the origin URL (or local path, honestly labeled) with an arrow-key
auth-mode toggle — ambient, mend-key, or bridge.

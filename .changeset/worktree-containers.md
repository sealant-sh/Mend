---
"@sealant/mend": minor
---

The worktree becomes the durable container: sessions are conversations inside it — many per
worktree, several live at once — with one change and one checkpoint chain per worktree. Launching
with an existing worktree name joins it (`--worktree` joins only); `s` in the dashboard starts a
session inside the selected worktree, Shift+D is the one explicit removal (refused while anything is
live), and deleting a session leaves the worktree, its change, and its checkpoints standing.
`mend worktrees` lists containers with their sessions; `mend sessions --json` stays byte-stable v1,
`--json=v2` emits the worktree envelope. Migration 0046 re-keys existing data
one-worktree-per-session; review slices may now span checkpoints from different conversations of one
worktree.

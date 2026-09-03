---
"@sealant/mend": patch
---

A new conversation inside an existing worktree (⇧S "session here" in the dashboard, the web's new
session in a worktree, `POST /worktrees/:id/sessions`) now claims a ready standby skeleton like
every other launch, instead of always creating a fresh workspace. A standby skeleton serves any
worktree since 0.18.0; this path had simply been left on the cold road.

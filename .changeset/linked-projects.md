---
"@sealant/mend": minor
---

Linked projects. A project's setup page gains a "Linked projects" section: pick another adopted
project and a name, and every next session of this project works in that project too, read-write, at
`/workspace/repos/<name>`. The linked project's named worktree is bound at launch (blank picks,
creating it if needed, the worktree named after its default branch); commits there are that
project's own change, reviewed on its side, never part of this session's change. Distinct from
references, which are read-only clones for reading, and from mounted folders, which are host paths
and so cannot exist on a cluster. Linking rewarms the hot pool.

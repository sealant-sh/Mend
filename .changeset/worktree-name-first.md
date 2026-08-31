---
"@sealant/mend": minor
---

The start-a-session flow asks the worktree's name first, then the session details — on the dashboard
(`n` opens the name input, then the harness picker), the CLI (`mend claude` asks on a TTY; `--name`
skips the ask), the web and desktop composers, and the phone. A named session gets branch
`mend/<name>` and worktree directory `<name>`; empty keeps the auto-derived identity. Named sessions
provision cold (hot skeletons carry pre-created worktrees), and a taken name fails with a readable
message.

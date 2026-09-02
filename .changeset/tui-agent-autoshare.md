---
"@sealant/mend": minor
---

The dashboard now shares this machine's ssh-agent with the server for as long as it runs, so
projects adopted with `--auth bridge` fetch their base before a worktree is created instead of
silently starting on whatever the store last fetched. The header says "agent shared"; a signature
request shows on the status line. `mend keys autoshare off` turns it off; `mend keys share` still
runs the relay in the foreground on a machine without the dashboard.

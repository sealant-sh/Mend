---
"@sealant/mend": minor
---

Git access is now a per-user choice, asked once on first run and kept in Settings: a Mend key of
your own on the server (recommended; add it to your git account's SSH keys and every repository
works, from detached sessions and the phone too, or add it as one repository's deploy key), or your
own machine's key through the bridge. New projects adopt with your choice; a project's setup page
still overrides it. `mend keys mode [mend-key|bridge]` sets it from the CLI.

The Mend key is per user, not per server. A server-wide key from before is claimed by the first user
who asks, so a public key already on your git host keeps working.

When your choice is bridge, every attaching `mend` command (codex, claude, opencode, run, attach,
shell, resume, rejoin) and the dashboard share this machine's ssh-agent for as long as they run, and
the dashboard header says "agent shared". Projects then fetch their base before a worktree is
created instead of silently starting on whatever the store last fetched. `mend keys share` still
runs the relay in the foreground on a machine without one.

---
"@sealant/mend": minor
---

Background sessions: launches take `--detach`/`-d` (start without attaching) and `--foreground` (the
session stops when this CLI exits), governed by the new background-sessions switch in Settings with
a per-project override. New `mend stop <prefix> | --all` ends a session explicitly — inside the
workspace too, via the staged helper. Attach now tells a dropped connection apart from a settled
session (no more "session ended" on a network cut), and SIGHUP/SIGTERM restore the terminal cleanly
instead of leaving raw mode pushed.

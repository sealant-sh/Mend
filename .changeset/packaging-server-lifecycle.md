---
"@sealant/mend": minor
---

Add server status, bounded logs, start, stop, restart, and explicit version upgrades. Verify
installation ownership before operations. Validate target artifacts before stopping writers and save
a private streamed database backup before activation. Retain the target pin and recovery files after
possible migrations, with no automatic downgrade or database restore. Bound subprocesses and recover
pre-startup failures without replacing identity or deleting volumes.

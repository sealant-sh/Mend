---
"@sealant/mend": minor
---

Harness state is durable by construction: every session mounts a store-backed harness home into its
workspace, and boot symlinks each harness's `$HOME` state dirs (`.claude`, `.codex`,
`.local/share/opencode`) onto it. A workspace that dies without settling no longer loses the
conversation — relaunch commits a capture from the live harness home and resumes natively instead of
failing with "Saved harness state is missing". The mounted home is also the server-side seam for
upcoming skills management.

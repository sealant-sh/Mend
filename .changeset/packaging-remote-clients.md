---
"@sealant/mend": minor
---

Support remote workspace SSH with per-server aliases, effective OpenSSH configuration checks, and
usable client-key validation. Keep host-key trust explicit and leave unrelated SSH configuration
intact.

Adopt repositories by network Git URL only. Reject local paths, option-like sources, and Git remote
helpers while preserving cwd project selection and session worktrees. Bundle the CLI's private
workspace dependencies so its npm tarball works outside the monorepo.

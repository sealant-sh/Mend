---
"@sealant/mend": minor
---

Sessions carry their base branch, visibly and currently. A session records the base as you named it
(`baseRef`) beside the pinned commit, and every surface shows it: the sessions table and dashboard,
the web lists, session page and review header, and the mobile session screen. The web composer and
the mobile start rows pick a base from the project's real branches instead of a blind text field.
Bases are current, not adoption-day stale: provisioning freshens the base ref from origin through
the project's git auth (best-effort — offline or signer-less still provisions on what the store
has), and `mend refresh [project]` (`POST /projects/:id/refresh`) fetches every origin branch into
the store on demand. Nothing is ever pruned; session branches are untouched.

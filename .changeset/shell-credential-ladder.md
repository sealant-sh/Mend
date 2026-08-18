---
"@sealant/mend": patch
---

`mend shell` sessions get the agent accounts you actually have. The shell workspace asked the
platform for credential bundles (Claude + Codex + GitHub, then Claude + Codex, then GitHub) and fell
back to none when any named account was not connected — a Codex-only user opened a shell with no
agent auth at all. The ladder now degrades per provider, so a Codex-only (or Claude-only) user still
lands on that account.

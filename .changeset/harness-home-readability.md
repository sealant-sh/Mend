---
"@sealant/mend": patch
---

External agents stay visible whatever their harness does to file modes. Workspaces run as root and
codex tightens its state to 0700, which blinded the store-side observer (uid 1000) — a codex run in
a workspace terminal never appeared. The relocate boot script now keeps the harness home
group/other-readable (a detached root mode-keeper loop), the observer warns instead of going
silently blind, and a conversation that went quiet before mend could see it is late-observed: the
row appears already-ended and the conversation is captured into the record.

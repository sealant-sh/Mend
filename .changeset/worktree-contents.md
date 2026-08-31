---
"@sealant/mend": patch
---

The dashboard shows what actually lives in each worktree: live agent and shell processes hang under
their worktree row beside the Services, and unnamed worktrees are called by their auto-name label
(or short session id) instead of the `session/<uuid>` branch noise. The attach and rejoin banners
use the same name.

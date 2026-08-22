---
"@sealant/mend": minor
---

Protocol-mode agent sessions: launch codex or claude as a structured byte protocol
(`codex app-server`, claude stream-json) instead of a PTY. The conversation becomes rows Mend owns —
authored turns, streamed items, and agent requests (approvals, questions) that block until a person
answers — with new session endpoints to submit and interrupt turns, list items and requests by
cursor, and respond to a pending request. A session with a live protocol agent reads `waiting` while
a request is pending. PTY launches are unchanged and remain the default; protocol mode requires a
workspace image with sealantd ≥ 0.11.

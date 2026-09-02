---
"@sealant/mend": minor
---

Paste an image into a session's terminal. Ctrl+V inside claude or codex reads the clipboard of the
machine the TUI runs on — the workspace container, which has none — so pasting a screenshot did
nothing anywhere in Mend. Now an image pasted or dropped onto the terminal (web, desktop) or the new
`img` key on the phone's key bar goes to `POST /sessions/:id/images`: Mend stores the bytes in the
session's durable harness home (mounted read-write into every workspace the session gets, never
inside the worktree, so nothing touches the change or the checkpoints) and the terminal pastes the
workspace path — which codex attaches as an image input and claude reads. PNG, JPEG, GIF, and WebP
up to 8 MB; the format is sniffed from the bytes.

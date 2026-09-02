---
"@sealant/mend": patch
---

Ctrl+V (image paste) and Ctrl+] (detach) in an attached terminal are now recognised in every form
the kitty keyboard protocol can send them. Codex asks the terminal to report all keys as escape
codes, and under that flag the lock modifiers ride along: with Num Lock on, Ctrl+V arrived as
`ESC[118;133u` instead of `ESC[118;5u`, slipped past the matcher, and reached codex's own clipboard
handler inside the workspace, which has no display and failed with an X11 error. The matcher now
parses the report (key code, modifiers, event type) and masks the lock bits.

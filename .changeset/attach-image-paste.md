---
"@sealant/mend": minor
---

Ctrl+V in an attached terminal (`mend codex`, `mend claude`, `mend attach`, the dashboard) now
pastes an image from this machine's clipboard into the session: the CLI reads the clipboard
(wl-paste on Wayland, xclip on X11, osascript on macOS), stores the image beside the session, and
pastes its workspace path, which codex and claude read as an attachment. Before, the keystroke
reached the agent's own clipboard handler inside the workspace, which has no display, and failed
with an X11 error. With no image on the clipboard the keystroke goes through untouched.

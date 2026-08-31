---
"@sealant/mend": patch
---

Detach works — and leaves a working terminal — while talking to claude. The claude TUI pushes the
kitty keyboard protocol through the PTY onto the user's own terminal: Ctrl+] then arrives as a CSI-u
escape instead of the 0x1d byte the attach loop scanned for (detach silently dead), and after any
detach the terminal kept encoding every keystroke as CSI-u junk. The detach key now matches both
encodings, and ending an interactive attach restores the local terminal (pops the kitty keyboard
stack, disables bracketed paste and mouse reporting, leaves the alternate screen, shows the cursor).
Reattach replays from 0, which re-establishes whatever the TUI had set.

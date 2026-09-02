---
"@sealant/mend": patch
---

Take a session over from a phone pickup. When a session is live in protocol mode (handed off to the
phone), `mend attach` and the dashboard's attach now hand it back to a terminal — end the protocol
agent, resume the same conversation as a TUI, and attach — instead of failing with "tty attach
unavailable" or dropping you into a bare bash shell. `mend rejoin` already did this; the two most
natural "get me in" entrypoints now match it.

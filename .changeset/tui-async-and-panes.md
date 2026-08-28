---
"@sealant/mend": minor
---

The dashboard is a drawn multi-pane workbench: projects and sessions panes side by side, a session
detail panel beneath them, and the harness picker as a panel in the detail slot — no painted
background, the terminal's own ground shows through, and chrome is near-mono with color only where
it states a fact. Async state moved to optimistic mutations: starting or resuming a session puts a
`starting` row in the list at the keystroke and leaves the keyboard free while the workspace
provisions, renames land immediately, and review comment triage never waits on a round trip. The
event stream is now parsed properly — heartbeats and per-record-line progress no longer refetch the
workbench, so an idle dashboard makes no requests.

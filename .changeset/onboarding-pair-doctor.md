---
"@sealant/mend": minor
---

Onboarding: `mend pair` prints a QR (and an eight-character code) that pairs a phone with this
machine — the phone gets its own revocable device token, listed and revoked under Settings →
Devices. `mend doctor` is a read-only checklist: server, sign-in, connected accounts, adopted
projects, local harness CLIs, tailnet address — each failing line names the command that fixes it.
`mend help` now opens with the getting-started sequence. A hidden `mend qr <text>` backs the
installer's closing QR.

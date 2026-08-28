---
"@sealant/mend": minor
---

Agents run by hand — in a mend shell, an SSH session, an editor terminal — become first-class: their
transcript writes through the mounted harness home are observed server-side and surfaced as
`agent-external` process rows ("claude (observed)"). The session reads as running, the workspace
lease holds while the agent works, and the conversation is harvested and natively resumable like any
engine-launched agent's. The row ends when the writes go quiet; Mend observes, it does not own the
process.

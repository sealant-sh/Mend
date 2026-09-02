---
"@sealant/mend": patch
---

`mend version` (also `--version`, `-v`): this CLI's version, then the server's when it answers —
`server 0.17.0 · http://…`, or `server · unreachable · http://…`. A mismatch is stated as a fact.
The CLI and the server drift apart in practice (an npm install here, a cluster roll there), and
"which one am I on" is the first thing any bug report needs.

---
"@sealant/mend": minor
---

`mend service connect [name…] [--port <n>]` brings live Services to THIS machine's loopback: each
connection tunnels over one authenticated WebSocket to the server, which pumps it into the same
workspace forward the server-side listener uses — works identically whether the server is your
laptop, a VPS, or a Kubernetes Pod. Service status lines now lead with what your terminal can
actually use (the tunnel on a remote server, the bind authority only on a local one), and Enter on
an idle session in the dashboard opens a fresh shell in the held workspace instead of failing with
"attach unavailable".

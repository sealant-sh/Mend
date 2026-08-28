---
"@sealant/mend": minor
---

`mend service run` reaches the Service in one step. On a local server nothing changes: the command
starts the Service and returns, and the bound endpoint already answers on this machine. On a remote
server (a VPS, a Kubernetes Pod) the CLI now keeps running and tunnels the Service's port to
`127.0.0.1` here — the same authenticated WebSocket `mend service connect` opens — instead of
printing a suggestion to run a second command. Ctrl-C closes the tunnel, never the Service.
`--no-connect` restores start-and-return. UDP Services are unchanged (no connection to tunnel).

The server side of the tunnel is now authorized as well as authenticated: `/api/service-tunnel`
refuses callers who are not the Service's session owner with 403.

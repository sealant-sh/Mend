---
"@sealant/mend": minor
---

Workspace SSH sets itself up. `mend ssh` shows the observed state (gateway, registered keys, ssh
config); `mend ssh setup` makes a machine ready once — it prefers the running ssh-agent's key so no
new key material is created, registers it under the signed-in user, and writes one managed
`Host mend-ws` block. The VS Code extension discovers the gateway through the server and offers the
same setup as a single dialog on first open; the manual gateway settings become overrides.

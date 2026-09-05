---
"@sealant/mend": minor
---

Docker inside workspaces on Kubernetes. Mend pins Sealant 0.27.0, which serves the workspace Docker
switch on Kubernetes deployments whose operator enabled `workspaces.docker` (a rootless daemon
beside the workspace, in a user-namespaced Pod). Where the deployment cannot serve it, the platform
refuses at create and the session now shows that refusal in one sentence, naming the two ways out,
instead of a launch failure minutes later. Platform error codes Mend branches on are read from the
error body again (the SDK reports the error's tag as its code), which also makes the
cluster-bindings refusal match the real platform.

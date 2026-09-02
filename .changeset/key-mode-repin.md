---
"@sealant/mend": patch
---

The Mend key's private half is pinned to mode 0600 on every use, not only when it is created. On
Kubernetes the volume's fsGroup policy adds group read/write to every file at pod start, ssh then
refuses the key ("UNPROTECTED PRIVATE KEY FILE"), and every mend-key fetch and push, host-side and
through the workspace shim, failed with "Permission denied (publickey)".

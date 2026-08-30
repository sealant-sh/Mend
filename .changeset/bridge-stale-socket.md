---
"@sealant/mend": patch
---

The agent bridge reconnects after a server restart on shared storage. A dead pod's socket file on an
NFS-backed mount answers `lstat` with EINVAL, and the bridge's cleanup (`rmSync`, which stats first)
threw that at every attach — `mend keys share` could never reconnect after a pod swap until someone
removed the file by hand. Cleanup now unlinks without statting; anything the filesystem still
refuses is left for `listen` to report loudly.

---
"@sealant/mend": patch
---

Ambient-mode remote git operations now use `StrictHostKeyChecking=accept-new`, matching mend-key and
bridge: a daemon has no terminal to answer a first-contact host-key prompt, so a server with an
empty known_hosts (a fresh pod) could never reach any remote. A changed host key still refuses, and
the failure message now names that one remaining case.

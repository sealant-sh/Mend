---
"@sealant/mend": minor
---

The dashboard hides settled sessions that never had a conversation — no transcript captured at
settle, none in the harness home — since there is nothing to resume or hand off;
`mend sessions --all` still lists them. Mend now records that fact once at settle (and classifies
older sessions once at boot). ⇧D on a session row removes that session and leaves the worktree; a
session killed a moment ago removes without a second stop, since the server closes its shells and
settles it on the way out. ⇧D on a worktree header still removes the worktree.

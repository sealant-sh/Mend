---
"@sealant/mend": patch
---

Project stores defend themselves against root-side git. Workspace containers run git as root against
the store's shared gitdir, and a root `git gc --auto` could leave the ref database root-owned —
locking the server (uid 1000) out of creating session refs, failing every new session on the
project. Stores now run `core.sharedRepository=group` with setgid group-writable trees: applied at
adoption, healed into existing stores on the next worktree create, and applied to each session's
worktree gitdir (where checkpoints write). A store already poisoned by an earlier root write still
needs a one-off root `chown -R 1000:1000` — only root can reclaim root's files.

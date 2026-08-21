---
"@sealant/mend": patch
---

The CLI now resolves the cwd's project the way you expect: a project adopted from GitHub matches any
clone of the same remote (https, ssh, `.git` spellings compared equal), and the directory-name
fallback goes through the same normalization `mend adopt` uses, so a checkout called `Mend` matches
the project `mend`. Previously a GitHub-adopted project only matched when the folder name was
spelled exactly like the store name, and `mend claude` from a mismatched folder would try to adopt
the repository again. The guess is now visible: `mend claude|codex|opencode` print
`✓ project mend · main · from cwd` before creating anything, and `mend projects` marks the cwd's
project with `▸`.

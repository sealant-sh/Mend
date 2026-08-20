---
"@sealant/mend": patch
---

`mend dotfiles` shows the repository's subdirectory when one is set. The dotfiles repository knob
now takes a repo-relative subdirectory: the launch archive is re-rooted there
(`git archive HEAD:<subdirectory>`), so a repo whose home tree lives in a subfolder — a `dots/`
directory, a stow package — applies to `~` without restructuring. Configured in Settings → Dotfiles.

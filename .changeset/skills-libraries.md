---
"@sealant/mend": minor
---

`mend skills` — skill libraries on the server. `mend skills push` scans `~/.agents/skills` (the
shared agent-skills convention; `--dir` overrides) and uploads every bundle to your library, or a
project's with `--project`; `--prune` removes server-side skills the directory no longer carries.
`mend skills` lists a library. Sessions receive the merged libraries in their harness home at launch
— claude and codex both discover them natively; a same-named project skill overrides a personal one.

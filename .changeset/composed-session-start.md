---
"@sealant/mend": minor
---

Start a session with a prompt: `mend claude "fix the auth test"` opens the harness with the quoted
prompt as its first message, and the session is named from it immediately instead of after the
45-second transcript poll. New flags on `mend claude|codex|opencode`: `--model <id>` and
`--effort low|medium|high|xhigh|max` map to the harness's own model and reasoning flags,
`--base <ref>` bases the worktree on a branch or sha, `--ask` restores the harness's permission
prompts instead of the default bypass, and `--fast` requests priority processing (codex
`service_tier=priority` — 1.5x speed at increased usage). The server composes the harness argv from
the structured start, so the same launch path backs the web composer. Bare `mend claude` and
`mend run -- <command...>` are unchanged.

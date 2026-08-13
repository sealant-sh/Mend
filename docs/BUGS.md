# Known bugs

Observed, reproducible, not yet fixed. Newest first; delete entries when they ship.

## 2026-08-13 · shell exit settles the session as failed

Entering a shell (shell-kind session, or a shell resume) and leaving it with a plain `exit` marks
the SESSION as `failed`. Suspects, unverified: the platform loses the exit code on a clean exit
(PLATFORM-FEEDBACK.md 2026-08-12), so a settle path that distinguishes success by exit code may
misread `undefined`; or the run-level settle (`supervise` → `waitRun`) reports a non-completed
outcome for bash. `watchPty` treats `undefined` as completed, so the failed verdict likely comes
from the supervision path, not the watcher. Fix belongs with the exit-code platform fix, or the
settle paths stop guessing when the code is unknown.

## 2026-08-13 · shell sessions: harness auth and state folders are wrong-shaped

Inside a shell-kind session (picker-spawned, harness "shell"), the agent CLIs are present (unified
image) but unauthenticated: `platformShape("shell")` falls to the default branch — opencode image
shape, `{ github }` credentials only — so no claude/codex connected-account credentials are
injected. Separately, the restored/converted state folders can reference PAST sessions the CLIs then
list but cannot open ("imagined" sessions). Needs: a real platform shape for shell sessions
(credentials for every baked harness), and a look at what state restore should place for a session
that never ran that harness.

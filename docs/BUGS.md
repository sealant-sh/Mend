# Known bugs

Observed, reproducible, not yet fixed. Newest first; delete entries when they ship.

## 2026-08-13 · shell state restore references sessions the CLIs cannot open

Inside a shell session, the agent CLIs list past conversations that fail to open ("imagined"
sessions). Likely the restored/converted harness state (the conversation-lands-everywhere launch
invariant) placing session files whose provider-side ids or paths don't resolve in this fresh
workspace. Needs: reproduce with a specific harness, inspect what the restore/convert placed in
`$HOME`, and decide what the invariant should write for a session that never ran that harness.

<!--
Fixed and removed:
- 2026-08-13 · shell exit settles the session as failed — bash's `exit` returns $? (^C then exit
  reads 130); the watcher now settles interactive shells as completed regardless of exit code,
  keeping the observed code in the summary. The platform run was never at fault (verified live:
  run settles completed/0).
- 2026-08-13 · shell sessions had no harness credentials — platformShape gained a "shell" branch
  injecting every baked harness's credentials, selected by what actually launches (argv "bash"),
  covering shell sessions AND shell resumes.
-->

## Graceful shutdown can wedge with live sessions

Observed 2026-08-13 while live-testing UDP Services: on `node --watch` restart (SIGTERM), the child
released :3105 but hung forever holding the Service listeners (TCP and UDP), all session unix
sockets, and its platform connections — the engine scope's teardown never reached the ServiceHost /
SessionSocketHost finalizers. Inspector dump showed the finalizer chain stalled with live watch
fibers; the suspect is an `Effect.tryPromise` on a pending SDK call (record stream / PTY status)
with no abort signal, which is uninterruptible while pending. Reproduced twice with 3 live sessions.

Mitigated in `apps/web/src/entry/main.ts` with a 5s shutdown deadline (unref'd timer →
`process.exit`). Root fix: thread `AbortSignal` through the engine's SDK polling calls so
interruption can actually cancel them.

# Known bugs

Observed, reproducible, not yet fixed. Newest first; delete entries when they ship.

## 2026-08-18 · connected accounts silently ignored when Mend's owner id is not the web-login user

**Onboarding blocker.** Sealant stores connected accounts under the user who connected them in the
Sealant web UI; Mend creates workspaces as `SEALANT_OWNER_USER_ID` (default `usr_local`, a seed user
who owns nothing). When they differ, every credential attempt at launch is answered
`No codex connected account matches "default"` (404) — and Mend's fallback chain in
`packages/sessions/src/engine.ts` (`withGitHubCredentialFallback`: `{codex,github}` → `{codex}` →
`{github}` → none) walks all the way down and launches an **unauthenticated** workspace with only a
`logWarning`. The user's first experience is Codex/Claude asking them to sign in, with no hint why.
Observed 2026-08-17: four `POST /v1/workspaces` → 404 in 30 ms, then a fifth with no credentials.

Root cause is a config mismatch, but the UX is the bug: nothing tells the user. Fix for onboarding
(all three, in this order):

1. **Make the harness-account fallback loud.** A missing GitHub account may stay quiet; a missing
   _harness_ account (codex/claude — the identity the agent runs as) must be surfaced: stamp on the
   session what actually attached, show `launched without codex account · owner <id> has none` in
   the session status line, and print the same at `mend codex`/`mend claude`.
2. **Show connected accounts in Settings → Sealant connection** for the configured owner (the API
   has the endpoint), so an owner mismatch reads as "connected accounts for usr_local: none —
   connect at <sealant url> as that user, or set SEALANT_OWNER_USER_ID to the id that owns them."
3. **Boot/`mend doctor` check**: warn when `SEALANT_OWNER_USER_ID` is unset or `usr_local` while the
   API is reachable and that owner has zero connected accounts. Better still, resolve the owner from
   the Sealant login instead of an env var — the seed default should not exist in a real setup.

Workaround today: set `SEALANT_OWNER_USER_ID` in Mend's `.env` to the id from
`SELECT owner_user_id FROM connected_accounts` (sealant_control_plane), restart `pnpm dev`.

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

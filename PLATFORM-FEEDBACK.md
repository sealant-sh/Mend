# Platform feedback

Mend consumes the Sealant platform only through the public SDK (`@sealant/sdk`). When the SDK is
missing something Mend needs, it gets recorded here as feedback for the platform — never worked
around by importing internals.

Format: date · SDK version · what Mend needed · what exists today · suggested surface. Entries stay
after they ship, marked **Shipped**, so the dogfood trail stays readable.

## 2026-07-25 · 0.7.1 · Worker needs `SEALANT_CREDENTIALS_KEY` too — released compose only gives it to the api

- **Needed:** a claude-harness workspace with connected-account credentials, on a self-host install.
- **Today:** in 0.7.x the worker decrypts credential refs at build time, but the released compose
  sets `SEALANT_CREDENTIALS_KEY` only on the api. The build fails with
  `credentials-key-unconfigured` (an excellent, actionable error — keep that). Local compose patched
  to pass the same key to the worker.
- **Suggested:** add the key to the worker service in the released compose.

## 2026-07-25 · 0.7.1 · Sealantd's secret scrub ate the platform's own credential injections (fixed in sealantd 0.6.1)

- **Needed:** the injected `CLAUDE_CODE_OAUTH_TOKEN` visible inside harness/PTY processes.
- **Today:** Core injects connected-account credentials as container env
  (`planCredentialInjections`), but sealantd's boot passthrough dropped every secret-looking key
  before spawning harness children — so builds succeeded and the harness still launched
  credential-less. Codex only worked because its injection is a file (`~/.codex/auth.json`). Fixed
  at the source in sealantd#38 (v0.6.1): the documented contract keys survive the scrub, plus a
  generic `SEALANT_HARNESS_ENV_KEYS` declaration for future providers. Local worker pinned via
  `SEALANT_SEALANTD_IMAGE` until Core bumps its default (`buildkit-builder.ts` pins 0.6.0).
- **Suggested for Core:** bump the sealantd pin to 0.6.1, and set `SEALANT_HARNESS_ENV_KEYS` in the
  runtime adapter whenever it plans env-kind credential injections, so the next provider needs no
  daemon release.

## 2026-07-25 · 0.7.0 · Mount allowlist env name drift: docs say one name, the server another

- **Needed:** enable mount-sourced workspaces on a self-host install.
- **Today:** the SDK's `WorkspaceMountSource` docs name `SEALANT_WORKSPACE_MOUNT_ALLOWED_ROOTS`; the
  0.7.0 api rejects with "set `SEALANT_MOUNT_ALLOWED_STORE_ROOTS`". Setting both works.
- **Suggested:** pick one (and add it to the released compose with a commented example).

## 2026-07-25 · 0.7.0 · Session transport in the api is docker-exec only — and the failure is a process crash

- **Needed:** `POST /v1/sessions` working on the released compose topology.
- **Today:** the api's only wired transport is `SealantRuntimeDockerExecLive`
  (`docker exec -i <container> socat - UNIX-CONNECT:/run/sealant/control.sock`), but the api image
  has no docker binary and the compose gives it no socket — and the spawn failure escapes as an
  unhandled `error` event that **kills the api process** (clients see "other side closed"). The
  ssh-gateway already solves this exact reachability problem with the shared read-only
  `/run/sealant/sockets` dir and no Docker access. Local unblock (patched into `~/.sealant`): mount
  a static docker CLI + `/var/run/docker.sock` + `group_add` the docker gid into the api — which
  grants the api host-root-equivalent power the gateway design deliberately avoids.
- **Suggested:** a socket-dir transport for the api like the gateway's (unix-connect via
  `/run/sealant/sockets`, no Docker), and guard the spawn path (`child.on("error")`) so a missing
  binary is a 502, never a process exit.

## 2026-07-25 · 0.7.0 · A PTY session's run never settles after the session exits

- **Needed:** supervision keyed on `run.wait()` / the record settling when the session's process
  exits — a session IS backed by a run, per the model.
- **Today:** the record faithfully carries `exit code=0`, but the run keeps emitting
  `runtimeHeartbeat` indefinitely and `run.wait()` never resolves; `GET /v1/sessions/:id` does
  report `status: "exited"`. Mend works around it by polling session status and settling from there
  (double-settle-guarded), keeping `run.wait()` as a backstop.
- **Suggested:** settle the session's run when the PTY exits (or document that session runs are
  workspace-lifetime and the session status is the authoritative lifecycle).

## 2026-07-25 · 0.7.0 · Mount + credentials: the worker's blueprint parser rejects the combination

- **Needed:** `mend claude` / `mend codex` — a mount-sourced workspace with the caller's connected
  account attached, exactly as the SDK documents ("Credentials and dotfiles options compose
  unchanged" on `WorkspaceMountSource`).
- **Today:** `workspaces.create({ source: { kind: "mount" }, credentials: { claude: true } })`
  queues a build job the worker kills at `parseWorkspaceBlueprint` — ZodError
  `Unrecognized key: "credentials"` — and the workspace reaches `failed` before ready. Without
  `credentials` the same create works. Mend currently omits credentials on launch (harness auth is
  interactive inside the PTY) until this lands.
- **Suggested:** accept the credentials key in the mount blueprint path — or if it is genuinely
  unsupported there, reject at CREATE time with a clear message instead of a failed build job.
- **Root cause (found in Core source):** the 0.7.0 SDK folds `credentials` into `spec.credentials`
  (`sdk/dist/internal/blueprint.js`); the api resolves it into `runtime.credentialRefs`
  (`apps/api/src/routes/workspaces/workspaces.module.ts` ~L1146:
  `body.credentials ?? resolvedSpec.credentials`) **but never removes `credentials` from
  `resolvedSpec`** before persisting the spec for the build job — so the worker's strict
  `parseWorkspaceBlueprint` (`packages/validators/src/workspaces/workspace-blueprint.ts`,
  `z.strictObject`) rejects the root-level key. One-line fix: strip `resolvedSpec.credentials` after
  resolving refs, plus a regression test for create-with-credentials reaching a green build.

## 2026-07-25 · 0.7.0 · ✅ What shipped works — mounts, PTY journal, and file events, verified live

**Adopted immediately** — noting the wins so the trail is honest: `source: {kind:"mount"}`
bind-mounted a store worktree
(`sealantd::boot::mount: "caller-owned mount; clone skipped, contents are never touched"`), writes
persisted after exit; `sessions.open` PTY ran with byte-exact sequence-keyed output; and the record
carried **fileChange events** for the PTY's writes — the 2026-07-08 file-watch gap is fixed for
mounted workspaces.

## 2026-07-25 · 0.5.2 · Workspaces sourced from a caller-provided mount (persistent store worktrees)

- **Needed:** the agent-workbench direction (`MEND-AGENT-WORKBENCH-PLAN.md` §8.1.A) keeps all
  repositories in a Mend-managed central store on the machine (bare repo + one git worktree per
  session) and runs every session in a managed workspace that mounts its worktree. This needs
  workspace creation from a mount instead of a fresh clone: writes land on the store worktree and
  persist after the workspace stops; the workspace never reprovisions or deletes the mounted source;
  record/exec/control semantics stay identical to clone-based workspaces.
- **Today:** `CreateOptions` only takes `repository` (a remote to clone) + `ref` — the workspace
  owns its copy and the work product dies with the container unless pushed. There is no volume/mount
  concept anywhere in the SDK surface.
- **Suggested:** extend workspace creation with a mount source — e.g.
  `workspaces.create({ mounts: [{ path, source }] })` or `source: { kind: "mount", path }` as an
  alternative to `repository` — with the mounted directory treated as caller-owned (persists across
  workspace stop/delete, never cleaned). This deliberately reuses the workspace noun; no new "host
  attachment" primitive is wanted. Clone-based workspaces remain correct for independent
  verification.

## 2026-07-25 · 0.5.2 · Interactive session lifecycle is a Phase-3 stub, and too small for the workbench

- **Needed:** the workbench's session surface (plan §8.1.B): PTY-backed interactive process with
  client attach/detach, streaming from a durable sequence (reconnect after browser/product restart),
  send input, resize, stop/signal, and lifecycle/waiting states. This is the M1 critical path —
  `mend codex` is an interactive supervised PTY, not a one-shot prompt run.
- **Today:** `harness.session()` exists but is marked Phase 3, and `InteractiveSession` is only
  `{ send(input), output(): AsyncIterable<Uint8Array>, close() }` — no resize, no detach/reattach
  semantics, no resume-from-sequence (unlike `run.record.stream({ from })`), no waiting-state
  reporting, and it presumably requires the creating handle (see the 2026-07-08 re-fetched-handle
  entry).
- **Suggested:** grow `InteractiveSession` toward parity with the record surface: durable
  sequence-based `output({ from })`, `resize(cols, rows)`, `signal(...)`, attachability from a
  re-fetched workspace/run handle, and a lifecycle status (`running | waiting | idle | ...`) so a UI
  can show "waiting for input" without parsing terminal bytes.

## 2026-07-25 · 0.5.2 · Connected-account providers are a closed set (claude/codex/github)

- **Needed:** the workbench is bring-your-own-agent — Codex and Claude Code first, but also OpenCode
  and arbitrary commands. Whatever identity those harnesses need must ride the same reference-only
  credential injection.
- **Today:** `WorkspaceCredentialsOptions` is exactly `{ profile, claude, codex, github }`. An
  OpenCode or custom harness has no slot, so it runs unauthenticated or the user bakes secrets into
  dotfiles (which defeats the reference-only model). Noting early, not urgent: the MVP validates
  with Codex and Claude Code, which are covered.
- **Suggested:** let profiles (or a generic `accounts: { [provider: string]: true | string }`) carry
  arbitrary named connected accounts with a declared injection shape (env var / file), so new
  harness kinds don't each require an SDK field.

## 2026-07-15 · 0.5.2 · Release artifact: compose.selfhost.yaml omits `SEALANT_CREDENTIALS_KEY`

- **Needed:** inference on connected accounts working on a stock self-host install — Mend's brief
  compilation and harness credentials both ride on it.
- **Today:** `apps/api` reads `SEALANT_CREDENTIALS_KEY` (inference refuses to run without it, and
  connected-account decryption falls back to a zero key), but the released `compose.selfhost.yaml`
  never passes it to the api service — compose only interpolates `.env` into `${...}` it knows
  about, so even an installer-written key never reaches the container. Found upgrading `~/.sealant`
  to 0.5.2: the local compose only had the key because it was hand-patched; the fresh release
  compose silently drops it. Re-patched locally (api env,
  `SEALANT_CREDENTIALS_KEY: ${SEALANT_CREDENTIALS_KEY:-}`).
- **Suggested:** add the env line to `compose.selfhost.yaml`'s api service (and have `install.sh`
  generate the key, if it doesn't); a release smoke test that exercises one connected-accounts call
  would have caught it.

## ✅ 2026-07-07 · 0.5.0 · Release artifact: api image cannot run inference

**Shipped in 0.5.1** — [sealant#107](https://github.com/sealant-sh/sealant/pull/107): the builder
stages the resolved platform package and the runtime image carries it next to `dist/`.

- **Needed:** `sealant.inference.respond()` working against the published `sealant-api:0.5.0` image
  — Mend's brief compilation depends on it.
- **Today:** the image bundles the API into `dist/` and ships no `node_modules`, but the Claude
  Agent SDK must spawn its vendored native binary; the resolver looks for
  `@anthropic-ai/claude-agent-sdk-{platform}-{arch}/claude` (agent-sdk 0.3.201) via
  `require.resolve` and every inference call fails with `Native CLI binary for linux-x64 not found`.
  Verified: `npm install --no-save @anthropic-ai/claude-agent-sdk-linux-x64` inside the container
  makes inference work end-to-end (a container-local patch — lost on recreate).
- **Suggested:** the runtime stage of `apps/api/Dockerfile` (Core repo) carries the platform
  package, version-locked to the bundled agent-sdk — e.g. copy the resolved package dir from the
  builder stage, or `npm install` it pinned in the runtime stage.

## ✅ 2026-07-07 · 0.5.0 · Release artifact: ssh-gateway env schema broke existing installs

**Shipped in 0.5.1** — [sealant#107](https://github.com/sealant-sh/sealant/pull/107): the
process-env parsers alias the sandbox-era names for a release.

- **Needed:** nothing from Mend's loop (the gateway serves interactive SSH only) — recorded so the
  observation isn't lost.
- **Today:** `sealant-ssh-gateway:0.5.0` crash-loops on a `~/.sealant` compose generated by an
  earlier installer: `Invalid environment variables` at boot — the env schema changed (the old
  compose passes `SANDBOX_SSH_GATEWAY_*`; current validators mention `WORKSPACE_SSH_GATEWAY_*`).
  Fresh 0.5.0 installs presumably pass (the release smoke test was green); upgrades in place break.
- **Suggested:** either accept the old names as aliases for a release, or have the installer/docs
  cover in-place upgrades (regenerate compose on version bump).

## 2026-07-07 · 0.5.0 · Pre-auth owner model: SDK default owns nothing visible

- **Needed:** Mend's SDK calls must see the connected accounts and workspaces the operator created
  through the Sealant web UI.
- **Today:** the SDK's host-local owner defaults to `usr_local`, while the web UI writes rows under
  the signed-in web user's id — so a default-configured SDK sees no connected accounts
  (`InferenceNotFoundError: No claude connected account matches "default"`) until
  `SEALANT_OWNER_USER_ID` is set to the web user's id by hand. Documented in `DEVELOPMENT.md`;
  `compose.yaml` passes it through.
- **Suggested:** noting rather than asking — the internal-config comment already says this
  disappears once auth lands. Until then, surfacing the web user's id somewhere copyable in the
  Sealant UI (or aligning the default owner) would save the next self-hoster the archaeology.

## 2026-07-08 · 0.5.1 · No file-change events recorded for harness edits (diff comes up empty)

- **Needed:** the brief's machine facts (`N files · +X / −Y`, the unified diff) and its
  `unrelated change` disposition come from `run.changes` / the record's `fileChange` and
  `fileDiffAvailable` events — the typed file-event taxonomy shipped in 0.5.0.
- **Today:** across a real ~10-minute `opencode` run that demonstrably edited a file and committed
  it (`git diff base..head` shows +92 lines in `FormApi.ts`), the record contained **only**
  `ioChunk` stdout/stderr and `runtimeHeartbeat` events — **zero** `fileChange` /
  `fileDiffAvailable`, and the `ioChunk` payloads are opaque (byte counts + content hash, no text).
  So `run.changes.diff()` is an empty string and `run.changes.files` is `[]` even though a real
  change landed. The file-watch telemetry is not capturing the harness's edits. Interim workaround:
  `@mend/sealant` reads the real diff from git (`git diff base..head` via `workspace.exec`) instead
  of trusting `run.changes`; this needs the workspace still alive at brief-compile time.
- **Suggested:** record `fileChange` / `fileDiffAvailable` / `fileSnapshotCompleted` events for
  edits the harness makes (the taxonomy exists; the watcher isn't firing for these writes), so a
  recording-grounded diff is available without a post-hoc git read. Separately, exposing byte-exact
  `ioChunk` text through the read surface would let the brief quote what the agent actually printed.

## 2026-07-08 · 0.5.1 · Re-fetched workspace handles cannot start a harness

- **Needed:** follow-up and verification runs start in a workspace that outlives the handle that
  created it (Mend's supervisor holds no handles across settles or restarts): fetch by id, start a
  harness.
- **Today:** `workspaces.get(id).harness.start(...)` throws
  `This workspace handle has no harness; use the handle returned by workspaces.create().` — only the
  creating handle carries the harness's invoke knowledge. Mend works with the public `/effect` ops
  instead (`createRunOp` with `harnessId` + a hand-assembled `command` from
  `harness.buildRunCommand`), which duplicates the facade's command construction at every consumer.
- **Suggested:** let a harness be attached to a fetched handle — `workspaces.get(id, { harness })`
  or `workspace.harness.with(harness).start(...)` — or move run-command construction fully
  server-side (the SDK's own harness.ts notes that migration is planned).

## 2026-07-07 · 0.5.0 · `/effect` exports the ops, not the composition layer

- **Needed:** Mend consumes the workspace/run object model Effect-natively: workspace ready-waiting,
  harness start, the record read surface (`commands()`/`transcript()`), and the resumable
  `record.stream({ from })` as a `Stream`. With 0.5.0 those still exist only behind the Promise
  facade — `dist/effect/run-harness.js` and friends are real but typed against unexported facade
  internals, and `@sealant/sdk/effect` exports only the api client, the flat operation effects, and
  `makeSdkRuntime`.
- **Today:** `@mend/sealant` runs flat calls (connection check, `inferenceRespondOp`) on the Effect
  core with typed contract errors, but keeps `Effect.tryPromise` around the facade for the stateful
  handles — a deliberate split, documented in `packages/sealant/src/client.ts`, rather than
  duplicating the facade's reconstruction/polling logic.
- **Suggested:** export the composition layer Effect-natively — e.g. a `Workspaces`/`Runs` service
  pair whose record surface returns `Stream`/`Effect` values — so Effect consumers never touch the
  Promise boundary.

## ✅ 2026-07-06 · 0.4.0 · Inference on connected accounts (no workspace)

**Shipped in 0.5.0** — `sealant.inference.respond()` (facade) and `inferenceRespondOp` (`/effect`):
server-side via the official agent SDKs on account references, caller-executed tool loop over
`sessionId`, JSON response format. Adopted as `@mend/inference`'s shipped `sealantProviderLayer`;
the dev-only direct layer remains for development.

- **Needed:** Mend's interface inference — brief compilation, run/failure summaries,
  reviewer-comment routing — must run model calls on the user's connected subscriptions (PRODUCT.md:
  "Mend hosts no inference"). These are short, tool-calling inference loops behind the interface,
  not code runs.
- **Today:** the only model-access path in the SDK is a harness inside a workspace
  (`workspace.harness.run/start`). Platform-side, the credential infrastructure is fully built
  (encrypted `connected_accounts`, server-side reference resolution, injection planner), but there
  is no inference surface — and `docs/connected-accounts-design.md` (Core repo) deliberately forbids
  raw model-API calls on stored credentials (ToS): internal features must go through the official
  agent SDKs (e.g. Claude Agent SDK with `CLAUDE_CODE_OAUTH_TOKEN`).
- **Suggested:** an inference endpoint on the control plane implemented **via the official agent
  SDKs** on server-resolved credentials — honoring the no-raw-calls rule — exposed as
  `sealant.inference.respond(...)` (+ streaming variant) with tool-calling support, taking the same
  account-reference credential shape as `WorkspaceCredentialsOptions` (`claude: true | "<account>"`,
  `codex: …`, `profile: …`). The design doc's §9 already sketches this as a follow-up. Until it
  ships, Mend hides inference behind an internal `InferenceProvider` service; the dev-only layer may
  call a provider directly, but the shipped default must be Sealant.

## ✅ 2026-07-06 · 0.4.0 · Deterministic exec in a workspace

**Shipped in 0.5.0** — `workspace.exec(argv, options)` returns `{ exitCode, run }` with the exec
recorded as a run record; exit codes are check data, not errors. Exposed as `SealantClient.exec`;
the causal proof (M2) builds on it.

- **Needed:** the causal proof (`base fails · head passes · revert fails`) and re-verification on a
  moved base are fixed command sequences (checkout ref → run repro/tests → record exit codes). They
  should be deterministic executions, not agent-mediated prompts.
- **Today:** the SDK exposes only `harness.run/start` (an agent interprets a prompt) and the Phase-3
  interactive `session()` stub. Platform-side the primitive already exists:
  `execInWorkspace(target, { executable, args, cwd })` in `packages/workspaces/src/sealantd`, and
  the run-exec queue already carries arbitrary `{ executable, args, cwd }` — a harness run is just
  an exec with harness framing. The gap is exposure, not capability.
- **Suggested:** a public endpoint + SDK method `workspace.exec(argv, { cwd?, env? })` returning
  exit code and output, recorded into the run record like any process (or a first-class "check run"
  primitive: a list of commands executed verbatim, one record).

## ✅ 2026-07-06 · 0.4.0 · `@sealant/sdk/effect` subpath not exported

**Shipped in 0.5.0** — the subpath exports the contract-derived `SealantApiClient` (+ layer), the
per-endpoint operation effects with typed contract errors, and `makeSdkRuntime`. `@mend/sealant`'s
flat calls now run on it; the remaining gap is the composition layer (entry above).

- **Needed:** Mend is Effect end-to-end; it wants the SDK's Effect-native core (services, `Stream`s,
  typed errors) instead of wrapping Promises.
- **Today:** README says the Effect core "will be reachable via the `@sealant/sdk/effect` subpath";
  `package.json` `exports` ships only `"."` (the Promise facade). The Effect modules exist in
  `dist/` but are not addressable.
- **Suggested:** export the subpath. Until then `@mend/sealant` wraps the Promise facade in Effect.

## ✅ 2026-07-06 · 0.4.0 · Typed record event taxonomy (the source trail)

**Shipped in 0.5.0** — `TimelineEntry` is a discriminated union of twelve typed kinds (including
`networkRequest`/`networkSourceObserved` for the source trail) with a human `summary` per entry and
an `unknown` forward-compatibility case. Mend's live cards now stream `entry.summary`; the run audit
and source trail (M2) build on the typed kinds.

- **Needed:** the brief's source trail — every source the agent opened, grouped
  `relied on / consulted / contradicted / discarded`, with provenance chips — requires semantic
  events in the record: network fetches (URLs), file reads, tool invocations, with stable typed
  kinds.
- **Today:** the taxonomy largely exists and is typed platform-side — 12 payload kinds in
  `@sealant/telemetry` including `networkRequest` (method/host/path/status) and a dedicated
  `networkSourceObserved`, plus file change/diff/snapshot events. But none of this reaches SDK
  consumers: `TimelineEntry` is `{ kind: string, data: unknown }`, and there is no file-_read_ event
  (only change/diff).
- **Suggested:** expose the typed event schemas through `@sealant/api-contracts` so
  `TimelineEntry.data` is discriminated by `kind` at the SDK surface; consider a file-read/open
  event for a complete local-source trail. Network-source events are already enough to start the
  brief's source trail.

## 2026-07-06 · 0.4.0 · Push events (SSE / control-plane webhooks)

- **Needed:** live mending cards and dispatcher wake-ups without tight polling.
- **Today:** `record.stream({ from })` is poll-backed (README: "SSE later"); resumable from a
  sequence, which covers crash-resume well. No control-plane webhook/event-subscription surface for
  run/workspace lifecycle.
- **Suggested:** SSE for `record.stream`, and a webhook-registration (or server-sent events) surface
  on the control plane for run/workspace lifecycle. Low priority — polling is acceptable at Mend's
  scale.

## 2026-07-06 · 0.4.0 · Workspace lifecycle close-out

- **Needed:** reclaim workspace resources when a run settles (Mend keeps evidence, not workspaces),
  and expire re-verification workspaces aggressively.
- **Today:** `stop()` / `restart()` / `expire()` are typed Phase-3 stubs
  (`SealantNotImplementedError`).
- **Suggested:** none — already planned; noting that Mend wants it by its GitHub milestone so
  long-running self-hosted instances don't accumulate workspaces.

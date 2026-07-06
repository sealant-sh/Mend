# Platform feedback

Mend consumes the Sealant platform only through the public SDK (`@sealant/sdk`). When the SDK is
missing something Mend needs, it gets recorded here as feedback for the platform — never worked
around by importing internals.

Format: date · SDK version · what Mend needed · what exists today · suggested surface.

## 2026-07-06 · 0.4.0 · Inference on connected accounts (no workspace)

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

## 2026-07-06 · 0.4.0 · Deterministic exec in a workspace

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

## 2026-07-06 · 0.4.0 · `@sealant/sdk/effect` subpath not exported

- **Needed:** Mend is Effect end-to-end; it wants the SDK's Effect-native core (services, `Stream`s,
  typed errors) instead of wrapping Promises.
- **Today:** README says the Effect core "will be reachable via the `@sealant/sdk/effect` subpath";
  `package.json` `exports` ships only `"."` (the Promise facade). The Effect modules exist in
  `dist/` but are not addressable.
- **Suggested:** export the subpath. Until then `@mend/sealant` wraps the Promise facade in Effect.

## 2026-07-06 · 0.4.0 · Typed record event taxonomy (the source trail)

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

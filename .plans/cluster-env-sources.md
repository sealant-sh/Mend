# Mend cluster environment sources — plan

> Status: planned 2026-08-25; revised the same day to resolve the security / product-scope /
> platform-boundary review (decisions recorded in §Decisions). Nothing implemented. Depends on one
> Sealant platform capability (§Platform dependency) that must ship generically in Core before Mend
> consumes it (§18 rule 6). Mend pins @sealant/sdk + api-contracts 0.23.0 today; the capability
> lands in whatever release Changesets produces next.

## Context

Mend's project environment has two source kinds, both value-bearing and both custodied by Mend:
**Configuration** (plaintext-by-design rows in `project_environment_variables`) and **Secrets**
(AES-256-GCM ciphertext in `project_secrets`, sealed with a machine-local key, write-only values).
Both resolve once per fresh workspace launch in `SessionEngine.provisionWorkspace` and ride
`workspaces.create` as `env` / `secretEnv` (`packages/sessions/src/engine.ts:1866-1952`).

That model assumes Mend is the source of truth for the values. On a Kubernetes deployment it is
usually not:

- The company already runs a sync layer — External Secrets Operator, Vault CSI, sealed-secrets —
  that materializes provider secrets into native Kubernetes `Secret` objects on a refresh interval.
  The app's environment already exists as Secrets and ConfigMaps in the cluster, next to where
  Sealant workspace pods run. Copying those values into Mend's Secrets store duplicates the sync
  layer, decays on rotation, and moves custody into a second system that the operator then has to
  audit separately.
- Cluster-resident development (the Tilt/Skaffold shape) means "start the dev server" is defined by
  the same Secrets/ConfigMaps the deployment consumes. A session that cannot see them cannot run the
  app.
- Cloud access on these clusters is identity, not material, **at rest**: IRSA / Workload Identity
  binds an IAM role to a ServiceAccount name, and there is no long-lived key to copy into Mend. At
  runtime the picture inverts: a pod running under that SA exchanges its projected token for real
  credentials with one HTTPS call. Binding an SA to workspaces is therefore a trust grant, not
  plumbing (§Security posture).

The decided direction (2026-08-25) is provider-agnostic and Kubernetes-first: Mend does not
integrate AWS/Azure/GCP/Doppler natively. A project on a cluster deployment declares its environment
**by binding** Kubernetes objects in the workspaces namespace; the operator's existing sync layer
owns provider integration. Mend's own Configuration/Secrets store remains the single-host/simple
path. The injector-CLI pattern (`doppler run` wrapping the launch argv) is documented as an operator
option, not built.

This plan follows Mend's product boundary: public-SDK-only consumption (`AGENTS.md`), never record
secret values (plan §15), evidence not verdicts (plan §16.4). Mend's own custody is minimal for this
kind: Mend stores object names only, and **no value ever transits Mend**. Values do transit the
Sealant worker and a short-lived per-run platform Secret at resolution time — stated plainly in
§Security posture, not papered over.

## Approach

Add a third project environment source kind, **Cluster bindings**, beside Configuration and Secrets:

- A cluster binding names one Kubernetes `Secret` or `ConfigMap` in the Sealant workspaces namespace
  that the operator has opted in for workspace use (§Security posture). The whole object's keys
  become workspace environment, resolved by the platform worker at workspace creation.
- A project may additionally declare one **workspace service account**: the ServiceAccount name the
  workspace pod runs under, for identity-based access (IRSA/Workload Identity). Mend does not manage
  IAM bindings; the operator binds the SA cluster-side and allowlists it platform-side. Declaring
  one hands the session agent that role for the session's duration — the panel says so in those
  words (§Security posture).
- Mend passes both through a new public SDK surface on `workspaces.create` (§Platform dependency)
  and stamps what each launch received on `session_runs`. Mend never reads, proxies, or stores a
  bound value.
- On installs whose platform runs workspaces on the local Docker runner, bindings cannot resolve.
  Behavior is fail-closed and loud, enforced by the platform's create-time typed rejection (§Local
  runner behavior).

### Canonical terminology and invariants

**Why not "cluster references":** `reference` is already a product noun —
MEND-AGENT-WORKBENCH-PLAN.md §17 (2026-08-01) declares it for upstream repositories cloned into the
store (`_references/<name>`); the setup route this feature targets already renders a References
panel for those, and `HotFingerprintInputs` already carries a `references` field naming them. This
kind is therefore **Cluster bindings**, and no identifier in this feature uses the word "reference".
No new top-level product noun: within the environment surface the three kinds are **Configuration**,
**Secrets**, **Cluster bindings** — the third named the way the first two are, a kind label on the
project environment page. Implementation terms:

- **Cluster binding** — a project-owned pointer to one Kubernetes Secret or ConfigMap by kind and
  object name. Carries no env names and no values.
- **Workspace service account** — an optional project-owned ServiceAccount name for workspace pods.
- **Cluster binding snapshot** — the immutable set (bindings + service account) resolved for one
  workspace launch and stamped on its `SessionRun`.

Invariants:

1. A binding stores `kind` + `objectName` only. Mend never learns the keys or values inside the
   bound object; the UI and API say so instead of pretending otherwise.
2. Bindings resolve at workspace creation — by the Sealant worker, not by kubelet at container start
   — so a launch's snapshot survives container crash-restarts. A live workspace is never mutated;
   rotation of a bound Secret reaches only workspaces created after the rotation.
3. The binding set is bound by the operator at project level, before launch. The coding agent has no
   surface to add, remove, or widen bindings: the session channel token (`MEND_SESSION_TOKEN`)
   grants session-channel operations only, not project settings mutations.
4. Explicit wins over bound: any name Mend supplies through Configuration, Secrets, or its own
   `MEND_*` channel vars takes precedence over the same name arriving from a cluster binding.
   Deterministic and platform-enforced — but **not** by Kubernetes `env`-beats-`envFrom`, which
   governs only the container-env lane. Bound ConfigMap keys join the worker's plain-env list ahead
   of caller env (last-wins ordering the adapter already owns); bound Secret keys merge as a
   distinguished lowest-precedence layer of the secret-channel boot merge, with platform- and
   channel-owned names winning on collision regardless of the bound object's contents. Both are
   required semantics in the platform ask (§Platform dependency); Mend never guesses the bound
   object's contents.
5. One snapshot per fresh launch; the `SessionRun` manifest records binding kind/names, the
   revision, and the service account — never values. All manifest columns NULL = explicit
   legacy/unknown, never inferred.
6. Every mutation bumps an aggregate revision, emits a pointer-only event, and invalidates warm
   hot-pool skeletons (the revision is a hot-fingerprint input).

## Exact semantics

### Scope and precedence

- Bindings are project-only, like the other two kinds. No machine/global defaults.
- Bound object names use the DNS-subdomain grammar (`[a-z0-9]([-a-z0-9.]*[a-z0-9])?`, max 253),
  validated at write time. Kind is `secret` or `configmap`. Uniqueness is
  `(project, kind, objectName)`.
- The bound object must exist in the platform's workspaces namespace (Mend helm default: `sealant`,
  `deploy/helm/mend/values.yaml:101`; a live install may override) **and** carry the platform's
  workspace opt-in label (§Security posture). Mend does not verify either at write time — it cannot,
  and pretending to would be a stale answer by launch time. A missing, unlabeled, or platform-owned
  object surfaces as a readable platform launch failure naming the binding.
- Effective precedence, weakest first:
  1. base-image `ENV` defaults;
  2. **cluster bindings** (bound object keys, both kinds — this rank is enforced on both delivery
     lanes per invariant 4);
  3. Configuration + Mend channel env (`MEND_SESSION_ENDPOINT`/`_ID`) — the platform's explicit env
     list;
  4. platform-owned `SEALANT_*` controls;
  5. Secrets + `MEND_SESSION_TOKEN` via the transient secret channel (sealantd boot merge);
  6. forced identity vars, connected-account credentials.
- Name-lane routing (`routeDotenvName`, the two-member `DotenvRoute` union) is unchanged. Cluster
  bindings carry object names, not env names, so the one-lane name-ownership invariant
  (`refusePlaintextOfSecret` / `evictPlaintextCopy`) does not extend to them; the shadowing rule in
  invariant 4 is the whole collision policy. Dotenv load never targets this kind.

### Lifecycle behavior

| Event                                            | Result                                                                                                                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add/remove binding, set/clear service account    | Saved atomically; aggregate revision bumps; hot skeletons rewarm; no running workspace changes.                                                                  |
| Start a new session (cluster install)            | Fresh workspace pod carries the current binding set and service account.                                                                                         |
| Start a new session (local runner, bindings set) | Platform refuses at create time with the typed error; Mend surfaces it naming the bindings. No workspace.                                                        |
| Bound Secret rotated by the sync layer           | Existing workspaces keep the values they started with — including across container crash-restarts (worker-side resolution); new launches see the rotated values. |
| Bound object missing/unlabeled at launch         | Platform launch failure naming the binding; Mend surfaces it as an ordinary launch error.                                                                        |
| Resume a settled session                         | Fresh workspace; current binding set; new `SessionRun` manifest.                                                                                                 |
| Hot skeleton claimed                             | Carries the binding snapshot it was provisioned with (stored manifest, adopt-time carry).                                                                        |
| Rewarm on a non-cluster install, bindings set    | Warming is skipped with an observed status line — never a refusal loop (§Local runner behavior).                                                                 |
| Attach an externally created/legacy run          | Manifest columns stay NULL — explicit unknown, never inferred.                                                                                                   |

Settings copy stays the standing sentence: changes apply to new workspace launches; running
workspaces keep what they started with.

### Local runner behavior

On a platform whose workspaces run on the local Docker runner, cluster bindings cannot resolve. The
behavior is explicit, not silent — and enforced at the right layer:

- **The platform rejects at create time.** `POST /v1/workspaces` on a non-k8s runtime with any
  `envFrom` or `kubernetes.serviceAccountName` returns a synchronous typed error with a stable code
  (`runtime-env-references-unsupported`). No workspace is created, no build job queues, no failure
  surfaces minutes later — the adapter keeps a guard as belt only. Adapter-time-only rejection is
  the anti-pattern already on record (PLATFORM-FEEDBACK 2026-07-25, mount+credentials ZodError:
  "reject at CREATE time").
- **That typed code is Mend's capability probe.** The former design — a helm-set `clusterCapable`
  flag as enforcement — is dropped; a config flag can lie in both directions. Mend passes bindings
  through unconditionally; the platform's synchronous rejection is the fail-closed check, and Mend
  maps it to its own typed launch refusal listing the binding names. The flag survives only as a UI
  hint driving the panel's degraded state, never as enforcement.
- Fail-closed is deliberate: launching without the bindings would hand the agent a dev environment
  missing the variables the app needs, and the failure would surface minutes later inside the
  session with no cause attached. Refusing at launch names the cause.
- **The panel on a non-cluster install disables add, keeps remove.** Notice: "This install runs
  workspaces on the local runner. Cluster bindings do not resolve here; declared bindings block
  launches — remove them to launch here." Shrinking mutations (remove binding, clear service
  account) stay enabled so a project whose data arrives on a non-cluster install (migration,
  restore, flag flip) is never trapped unlaunchable. The API and CLI mutation surface is
  install-independent: every verb works on every install; only the panel's add affordance is
  disabled as guidance.
- **Hot pool:** rewarm for a project with declared bindings on a non-cluster install skips warming
  with an observed status line ("warm skipped · 2 cluster bindings · local runner") instead of
  looping on the refusal; a subsequent cold start still refuses with the typed error as above.

### Non-goals

- Provider SDK integrations (AWS/GCP/Azure/Vault/Doppler clients) in Mend. The sync layer owns
  providers.
- Storing, proxying, caching, or displaying bound values in Mend — ever, for this kind. Mend holds
  object names only.
- IRSA/Workload Identity management: Mend records a ServiceAccount name; the operator creates the
  SA, binds IAM, and allowlists it platform-side.
- Per-key bindings (`secretKeyRef`-style key picking), key prefixing, or renaming bound keys.
  Whole-object only in v1; per-key is an open question.
- Verifying bound objects exist at write time, or enumerating cluster Secrets to offer a picker.
  Listing namespace secrets from Mend would require a cluster read grant Mend itself never holds
  (the Sealant worker holds the namespace read; Mend does not).
- Mutating a live workspace's environment; reacting to Secret rotation in running workspaces.
- Injector-CLI execution (`doppler run` wrappers). Documented for operators; not built.
- Extending dotenv load or the name-lane routing to this kind.

## Security posture

Two escalation surfaces to answer. First: on Kubernetes, RBAC on `secrets` does not constrain what a
pod may read — anyone who can make a pod exist in a namespace can reference any Secret there and
read it from inside; "workspace may mount anything in the namespace" is the documented Argo
Workflows failure mode. Second: pod identity — an SA bound to a cloud role turns any pod running
under it into a holder of that role. A session workspace is a pod running an untrusted agent that
executes repository code with open egress. The posture:

- **The platform binds the set; the workload author never writes the binding.** The binding set is
  project configuration, edited through Mend's authenticated settings API by the same principals who
  edit Secrets today. The agent inside the workspace holds only the session channel bearer, which
  cannot touch project settings. Nothing the agent writes into the worktree or its processes can
  alter which objects the next pod receives.
- **Bindability is a platform-enforced opt-in, not namespace membership.** Only objects carrying the
  opt-in label (ask: `sealant.sh/workspace-env: "true"`) are resolvable, and objects labeled
  `app.kubernetes.io/managed-by=sealant` or matching platform resource-name patterns are refused
  unconditionally — enforced in the worker at resolution time with a readable failure naming the
  binding. This is not optional operator homework: the platform's own per-workspace Secrets
  (`<name>-env` with connected-account tokens and clone auth, `<name>-launch`, `<name>-tls`;
  `Core/packages/workspaces/src/runtime/kubernetes/names.ts:55-58`) live in this same namespace with
  predictable names, and without the enforced contract, binding another workspace's `-env` Secret
  would be cross-workspace credential exfiltration one project-settings write away. ESO and
  sealed-secrets stamp labels via templates, so the sync-layer story survives intact. Namespace
  curation remains good hygiene; it is no longer the only boundary.
- **One namespace, many projects: mutual trust, stated.** All Mend projects' workspace pods share
  one workspaces namespace, and a binding may name any opted-in object there — nothing scopes a
  project's bindable set to "its own" objects; project A can bind an object synced for project B.
  Decision: in v1, all principals who can edit project settings on one Mend install are mutually
  trusted with every workspace-opted-in object in the namespace, and the panel and deployment docs
  say so in those words. An install that must split that trust runs one Mend + Sealant install per
  trust domain (each with its own workspaces namespace) — the supported multi-tenant shape.
  Per-project label scoping (operator stamps a project label the worker matches) is the recorded
  follow-up if a single install ever has to split trust.
- **Custody is honest: the worker copies bound Secret values.** Worker-side resolution means the
  Sealant worker — which already holds `secrets: get,list` namespace-wide in its RBAC (Core deploy
  charts, `rbac.yaml:58-60` / `sealant-worker.yaml:32-34`); this design adds `configmaps: get`, not
  the secrets grant — reads bound objects at workspace creation and writes the values into the
  per-run Sealant launch Secret in etcd. That is a second, short-lived copy, deleted at teardown,
  and the operator docs account for it (etcd encryption at rest, teardown verification). "No value
  ever transits Mend" holds; "no second copy exists anywhere" does not, and this plan does not claim
  it.
- **Admission policy is a belt only where the pod spec can see the object.** Under worker-side
  resolution the workspace pod spec references only the per-run Sealant Secret, never the operator's
  object name — so a ValidatingAdmissionPolicy inspecting workspace pods' secret references cannot
  constrain the binding path at all; the worker-enforced label opt-in is the control there, and the
  docs say so instead of selling an inert belt. A VAP does see `serviceAccountName` and is real
  defense in depth for pod identity; the docs ship that sample with an honest statement of what it
  can and cannot check.
- **A bound ServiceAccount hands the agent the role — say so.** The allowlist constrains _which_
  identity a project may claim, never whether the agent can use it. An agent under an IRSA/WI SA
  exchanges the projected token for the role's credentials itself — one HTTPS call to STS/the
  metadata server from inside the pod. Those credentials never transit the launch secret channel, so
  they never seed sealantd's redactor: an agent that drains the role and exfiltrates the credentials
  over its own egress leaves no redacted trace, and Mend's records show only the SA name. Setting a
  workspace SA is therefore a per-project trust decision, and the panel states it in exactly those
  terms: "the session agent holds this role's full permissions for the whole session; bind a
  least-privilege role intended for untrusted code." Operator docs recommend least-privilege roles
  scoped for untrusted code and include the STS / cloud metadata endpoints in the egress-restriction
  guidance, so operators who allowlist an SA for non-cloud purposes can block token exchange
  outright. "Identity, not material" is a statement about storage at rest, not a safety property at
  runtime — at runtime the agent obtains exactly a credential.
- **`automountServiceAccountToken` stays `false`, unconditionally.** IRSA's webhook injects its own
  projected STS-audience token volume and GKE Workload Identity goes through the metadata server —
  neither needs the Kubernetes API token that automount governs. Enabling automount would
  additionally hand the agent a live kube API credential carrying whatever RBAC the operator bound
  to that SA: a separate grant nobody asked for. The current hardwired `false` (`manifests.ts:439`)
  survives this feature unchanged; if a workload someday genuinely needs the kube API token, that is
  a separate, separately-allowlisted opt-in — not a rider on IRSA support.
- **Recorded output stays redacted — for the secret lane.** Bound-Secret values ride the platform's
  secret channel and seed sealantd's redactor; the platform ask requires this (§Platform dependency)
  — pure `envFrom` would deliver values the redactor never learns. The redactor's reach ends at
  values that transit the channel: cloud credentials the agent mints itself (previous bullet) are
  outside it by construction.
- **Audit trail.** Binding mutations are timestamped rows plus pointer events; every launch stamps
  the exact binding set and service account on its `SessionRun`, so "what could this session read"
  is answerable per run from Mend's own records, and "who could have set that" from the settings
  audit surface. Per-principal actor stamping on mutations rides the identity workstream (open
  question below).
- Mend records binding names and grants, never values — the standing §15 rule, satisfied for Mend's
  own custody by construction since values never reach Mend.

## Data model and contracts

### Domain (`packages/domain/src/workbench/`)

New sibling module `project-cluster-binding.ts` beside `project-secret.ts`:

- `ProjectClusterBinding` — id, projectId, kind (`secret` | `configmap`), objectName, revision,
  timestamps. No env names, no values.
- `ProjectClusterBindingSnapshot` — aggregate revision, kind/name-ordered bindings, and the
  workspace service account (nullable).
- `validateClusterObjectName` — DNS-subdomain grammar, length 1–253. Not the env-name grammar; these
  are Kubernetes object names.
- `SessionRun` manifest grows `clusterBindingRevision`, `clusterBindingNames` (`kind/objectName`
  strings, e.g. `secret/app-env`), `clusterServiceAccount` — all nullable, all-NULL =
  legacy/unknown.
- `DotenvRoute` and `EnvironmentLoadedEntry` are unchanged (no third lane member; this kind is not
  name-addressed).

### DB (`packages/db/`)

- New table `project_cluster_bindings` cloning the `project_secrets` shape minus the value column:
  id, projectId FK cascade, kind, objectName, revision default 1, timestamps, unique
  `(project_id, kind, object_name)`.
- `projects.cluster_binding_revision` (integer, default 0) and `projects.workspace_service_account`
  (nullable text). Service-account changes bump the same aggregate revision.
- `session_runs` columns `cluster_binding_revision`, `cluster_binding_names`,
  `cluster_service_account`, nullable.
- New repo `project-cluster-bindings.ts` with the house discipline: every mutation locks the project
  row `FOR UPDATE`, re-checks the aggregate under the lock, bumps the revision before commit, emits
  a pointer-only event; snapshot is one statement (wholly-before or wholly-after).
- Migration: next free number at implementation time (numbering is a known contention point — check
  in-flight branches first).

### API contracts (`packages/api-contracts/src/project-environment.ts`)

Third `HttpApiGroup` beside `projectEnvironmentGroup` / `projectSecretsGroup`, errors as arrays
(never `Schema.Union` — union collapses `httpApiStatus` to 500):

- `GET /projects/:id/cluster-bindings` → `{ revision, bindings[], serviceAccount, clusterCapable }`
  (the flag is the UI hint for the panel's degraded state — never enforcement).
- `POST /projects/:id/cluster-bindings` → created binding + aggregate revision. 422 on grammar, 409
  on duplicate. Works on every install (mutations are install-independent).
- `DELETE /projects/:id/cluster-bindings/:bindingId` → new aggregate revision.
- `PUT /projects/:id/cluster-bindings/service-account` → `{ serviceAccount: string | null }` +
  aggregate revision.

### Routes (`apps/api/src/routes/workbench.ts`)

Third GroupLive following `ProjectSecretsGroupLive`: AuthMiddleware, typed failures, and
`rewarmHotSessions(projectId)` on every mutation — where rewarm on a non-cluster install with
bindings skips warming with the observed status line (§Local runner behavior). No eviction helpers
needed (no name lane).

### tRPC / web client

`environment.*` router gains `clusterBindings` query and `addClusterBinding` /
`removeClusterBinding` / `setServiceAccount` mutations with structured outcomes (drafts survive
409/422), following `apps/web/src/lib/project-environment.ts`.

## Launch-time resolution flow

All in `SessionEngine.provisionWorkspace`, in the slot the two existing kinds already use:

1. Read `projectClusterBindings.snapshot` alongside `projectEnvironment.snapshot` and
   `projectSecrets.sealedForLaunch` (one coherent read each).
2. Pass the snapshot through the SDK at workspace creation (engine.ts ~1920, beside the existing
   `env`/`secretEnv` spreads): `envFrom: [{ kind, name }, ...]` (kind/name-ordered),
   `kubernetes: { serviceAccountName }`; spreads omitted when empty, like `env`/`secretEnv` today.
   No Mend-side capability pre-check: the platform validates at create time and a non-k8s runtime
   refuses synchronously with `runtime-env-references-unsupported` — Mend maps that typed code to
   its own launch refusal listing binding names. No workspace exists, no partial environment ships.
3. The platform worker resolves both kinds at creation per the delivery contract (§Platform
   dependency). Mend never sees the values.
4. Extend `environmentManifest` (engine.ts ~1914) with `clusterBindingRevision`,
   `clusterBindingNames`, `clusterServiceAccount`; stamped on `session_runs` at run creation.
5. Add `clusterBindingRevision` to `HotFingerprintInputs` (engine.ts ~4057) so binding mutations
   invalidate warm skeletons — beside the existing `references` field (dependency sources), which
   the binding name deliberately does not collide with. Skeleton provisioning stores the extended
   manifest and `adoptClaimedWorkspace` carries it, unchanged in shape.

What Mend cannot observe: rotation of a bound Secret does not touch Mend's revision, so warm
skeletons provisioned before a rotation carry pre-rotation values until claimed or expired. Factual
limitation, documented in the panel copy and deployment docs; mitigation is skeleton TTL and the
operator rewarm action (open question). Worker-side resolution buys the converse property: a
container crash-restart keeps the launch snapshot (the per-run Secret is fixed), so the "immutable
snapshot per launch" line on `SessionRun` is true across restarts, not only until the first crash.

## UI and CLI

- **Web**: a **Cluster bindings** panel on the project setup route
  (`projects.$projectId_.setup.tsx`) — clearly separated from the existing References panel there,
  which names dependency-source repositories and keeps its meaning. Rows read
  `secret/app-env · resolved by the platform at launch · contents unknown to Mend`. Add = kind
  selector + object name input; remove confirms with the standing "running workspaces keep what they
  started with" line. A separate Workspace service account field with the trust language verbatim:
  "the session agent holds this role's full permissions for the whole session; bind a
  least-privilege role intended for untrusted code — the operator binds and allowlists it
  cluster-side; names outside the allowlist fail the launch". Non-cluster installs: add disabled
  with the local-runner notice, remove/clear enabled (§Local runner behavior). No value display
  exists to design.
- **CLI**: `mend env cluster add secret <name>`, `mend env cluster add configmap <name>`,
  `mend env cluster remove <kind>/<name>`, `mend env cluster sa [<name>|--clear]`. All verbs work on
  every install. `mend env show` gains a third section listing bindings in the same terse mono
  register as the secrets lines. `mend env load` is untouched.
- Status/error copy stays observational: "launch refused · 2 cluster bindings · local runner",
  "binding secret/app-env not found in namespace sealant", "warm skipped · 2 cluster bindings ·
  local runner" — never "unsafe"/"safe".

## Platform dependency

Mend consumes Sealant only through the public SDK; this feature needs one new create-time surface,
implemented generically in Core first (§18 rule 6). Today: `CreateOptions.env`/`secretEnv` are
literal `Record<string,string>` end to end; nothing reference-shaped is expressible; the k8s
adapter's `secretKeyRef` use is internal-only; `serviceAccountName` is fixed per install
(`SEALANT_K8S_WORKSPACE_SERVICE_ACCOUNT`, `automountServiceAccountToken` hardwired false); the
Docker adapter has no such fields.

The ask (full entry text at the end of this document) is stated as required semantics:

- **Surface.** `workspaces.create` accepts one ordered list,
  `envFrom?: readonly { kind: "secret" | "configmap"; name: string }[]` — one array, last-wins
  across kinds, so cross-kind key collisions have a caller-expressible winner and non-k8s runtimes
  have exactly one field to reject — plus `kubernetes?: { serviceAccountName?: string }`, the one
  honestly runner-specific field. Both are non-secret config riding the existing opaque `spec`
  (blueprint `runtime` schema); no wire-contract change.
- **Bindability contract.** Only objects carrying the opt-in label
  (`sealant.sh/workspace-env: "true"`) resolve; objects labeled
  `app.kubernetes.io/managed-by=sealant` or matching platform resource-name patterns are refused
  unconditionally. Enforced in the worker at resolution time with a readable failure naming the
  object. Not delegated to optional admission policy: the platform's own per-workspace Secrets live
  in this namespace with predictable names.
- **Delivery: worker-side resolution for both kinds.** The worker resolves bound objects at
  workspace creation. ConfigMap keys join the plain env entries, placed before caller env so
  explicit wins under the adapter's existing last-wins ordering — literal `envFrom` is ruled out
  even for ConfigMaps because sealantd's boot scrub silently drops secret-marker key names
  (`FOO_TOKEN`, `*_KEY`) from container-env passthrough (`boot/config.rs:825-850` `is_secret_key`),
  and kubelet re-resolves `envFrom` on container restart, breaking launch-snapshot semantics. Secret
  keys ride the existing `SEALANT_SECRET_ENV_FILE` launch channel, which preserves secret-marker
  names and seeds the redactor. **Ordering is an explicit semantic, not an accident of merge
  order:** bound-Secret keys merge as a distinguished lowest-precedence layer — below caller `env`
  and `secretEnv`, and platform-owned / MEND channel names win on collision regardless of the bound
  object's contents (channel entries applied last, or bound keys dropped on collision). Kubernetes
  `env`-beats-`envFrom` is cited nowhere: it governs no lane this design uses.
- **Custody and bounds.** Worker-side resolution copies bound Secret values into the per-run Sealant
  launch Secret in etcd (deleted at teardown) — the ask states this so the operator docs can account
  for the copy, and documents payload bounds (the per-run Secret rides etcd's ~1MiB object limit;
  bound objects count toward it). Worker RBAC gains `configmaps: get` in its workspaces namespace
  (it already holds `secrets: get,list`) — a helm/RBAC change the ask calls out explicitly.
- **ServiceAccounts.** `serviceAccountName` honored only against an install-config allowlist (e.g.
  `SEALANT_K8S_ALLOWED_WORKSPACE_SERVICE_ACCOUNTS`); a name outside it fails the launch readable.
  `automountServiceAccountToken` stays `false` unconditionally — IRSA/WI inject their own token
  paths and do not need the kube API token; any future kube-API-token need is a separate opt-in.
- **Create-time rejection.** Non-k8s runtime + any `envFrom` / `kubernetes.serviceAccountName` →
  synchronous typed error at `POST /v1/workspaces` with stable code
  `runtime-env-references-unsupported`; adapter guard as belt. The typed code doubles as the SDK
  consumer's capability probe.
- **Restart semantics.** Container crash-restarts keep the launch snapshot (per-run Secret is
  fixed). Platform restart-from-blueprint re-resolves bindings (they are in the blueprint, unlike
  `secretEnv`, which restarts run without) — stated in the SDK docs.

## Milestones

**M1 — Sealant platform capability (Core, gates everything).** SDK `CreateOptions.envFrom` +
`kubernetes.serviceAccountName`, blueprint schema, worker-side resolution of both kinds with the
ordering semantics above, label opt-in + platform-object refusal, SA allowlist with automount
unchanged-false, create-time typed rejection, worker RBAC (`configmaps: get`) in the helm charts.
E2e against the pinned sealantd image proving: bound values reach harness child env with
secret-marker names intact for **both** kinds; recorded output is redacted; explicit env shadows
bound names on both lanes; a crafted bound Secret with key `MEND_SESSION_TOKEN` does not displace
the channel token; unlabeled and platform-managed objects are refused readable; unknown SA fails
readable; non-k8s create rejects with the typed code. Release gate: published SDK + deployed control
plane/worker before Mend consumes anything.

**M2 — Mend store and surfaces.** Domain module, table + migrations, repo, contracts, GroupLive,
tRPC router, web panel (with the non-cluster degraded state), CLI verbs. Builds against the current
SDK.

**M3 — Launch wiring (needs the M1 release).** Pin the released SDK; snapshot read + create-time
pass-through + typed-refusal mapping + manifest stamping + hot-fingerprint input + rewarm skip.
Fake-engine tests assert the exact binding set passed once to `createWorkspace`, the typed-error
mapping, and NULL manifests on attach.

**M2/M3 ship as one release — a gate, not a preference.** A panel that accepts declarations launches
must honor is the contract; an M2-only release would silently ignore declared bindings, the exact
failure §Local runner behavior refuses. PRs may land separately, but the mutation surface (panel
add + CLI mutation verbs) stays disabled until M3's wiring is in the same release train.

**M4 — Deployment docs and cluster verification.** Helm values note for the workspaces namespace;
the operator contract rewritten around the enforced label opt-in (ESO/sealed-secrets templates
stamping `sealant.sh/workspace-env`); the mutual-trust statement for multi-project installs and the
install-per-trust-domain shape; the custody note (per-run Secret copy, etcd encryption at rest); the
SA trust language, least-privilege guidance, and egress-restriction guidance including STS / cloud
metadata endpoints; the sample VAP with its honest scope (SA names yes, secret bindings no);
rotation semantics. Live matrix on the Talos PoC.

## Steps

- [ ] Record the platform ask in PLATFORM-FEEDBACK.md; land the capability generically in Core with
      e2e proof; publish/deploy the release.
- [ ] Land Mend domain/db/contracts/routes/panel/CLI (M2) with the mutation surface disabled.
- [ ] Pin the released SDK; wire launch pass-through, typed-refusal mapping, manifest, hot
      fingerprint; enable the mutation surface; release M2+M3 together (M3).
- [ ] Land deployment docs + admission-policy sample; run the live matrix on the PoC cluster (M4).
- [ ] Update MEND-AGENT-WORKBENCH-PLAN.md §17 with the decision entry.

## Verification

Repo-required `pnpm exec turbo typecheck --force` + `lint --force` per PR, plus one live matrix
against the released platform on the Talos PoC:

1. Binding to an ESO-synced, labeled Secret: values visible to harness, shell, Service, exec paths;
   a canary value printed by a process appears **redacted** in the record.
2. Secret-marker key names (`DATABASE_PASSWORD`, `API_KEY`) arrive in the harness child env from a
   bound Secret **and** from a bound ConfigMap (the boot scrub must not eat either).
3. Shadowing: same name in Configuration and in a bound Secret — Configuration wins; same name in a
   bound ConfigMap — Configuration wins; a crafted bound Secret containing key `MEND_SESSION_TOKEN`
   does not displace the real channel token (channel-wins semantic, not env/envFrom).
4. Refusals, each naming the binding with no workspace created: missing object; object without the
   opt-in label; platform-managed object (another workspace's `-env` Secret).
5. Local runner: create refuses synchronously with `runtime-env-references-unsupported`; no
   workspace, no build job; Mend's refusal lists binding names; panel shows add-disabled state and
   remove still works.
6. Rotation: rotate the synced Secret; a running workspace keeps old values; a crashed-and-restarted
   container still holds the launch values; a fresh launch sees new values; a pre-rotation warm
   skeleton claimed after rotation carries old values (documented limitation, asserted not hidden).
7. ServiceAccount: allowlisted SA + IRSA works end-to-end on the PoC **with automount still off**
   (`/var/run/secrets/kubernetes.io/serviceaccount` absent in the pod); non-allowlisted name fails
   readable; the run's manifest records the SA name.
8. Mend custody: grep Mend DB, logs, events, API responses, and session-run rows for the canary —
   only names and revisions exist. Confirm the per-run platform Secret is deleted at teardown.
9. Hot pool: binding mutation rewarms skeletons; manifest carried on adoption; rewarm on a
   non-cluster install skips with the observed status line.

## Decisions (2026-08-25 review)

Recorded here because a review finding forced each one:

- **Kind renamed to Cluster bindings.** `reference` is a §17 product noun (dependency-source
  repositories); the setup route and `HotFingerprintInputs` already use it. No identifier in this
  feature uses "reference".
- **Bindability is a worker-enforced label opt-in.** Namespace membership plus optional admission
  policy was insufficient: a VAP cannot see operator object names under worker-side resolution, and
  the platform's own credential-bearing Secrets share the namespace. The opt-in label plus
  unconditional refusal of platform-managed objects is a platform contract, enforced at resolution.
- **Both kinds resolve worker-side.** Literal `envFrom` for ConfigMaps would silently lose
  secret-marker key names at sealantd's boot scrub and break launch-snapshot semantics on container
  restart. Cost accepted: worker RBAC gains `configmaps: get`.
- **Custody framing corrected.** Bound Secret values transit the Sealant worker and a short-lived
  per-run Secret in etcd. "No value transits Mend" stands; "the cluster resolves at pod creation, no
  copy exists" was dropped as false for the secret lane.
- **Invariant 4's mechanism restated.** Kubernetes `env`-beats-`envFrom` governs no lane this design
  uses; explicit-wins and channel-wins are required merge semantics in the platform ask.
- **`automountServiceAccountToken` stays false unconditionally.** IRSA/WI do not need the kube API
  token; the automount rider was struck from the ask.
- **SA binding is a stated trust grant.** An allowlisted IRSA/WI SA hands the agent the role for the
  session; the credentials never seed the redactor, so exfiltration is invisible to the record. The
  panel, docs, and this plan say so; egress guidance covers STS/metadata endpoints.
- **Multi-project posture stated.** V1: all project-settings principals on one install are mutually
  trusted with the namespace's opted-in objects; hard isolation = one install per trust domain;
  per-project label scoping is the recorded follow-up.
- **Capability probe = the platform's create-time typed error**
  (`runtime-env-references-unsupported`). The helm `clusterCapable` flag is demoted to a UI hint; it
  can lie, the typed error cannot. (Resolves the former open question.)
- **M2 and M3 are one release**, with the mutation surface disabled until launch wiring lands.
- **Non-cluster installs can always shrink.** Panel disables add only; remove/clear, API, and CLI
  mutations are install-independent; rewarm skips instead of looping.

## Open questions

- Per-key bindings and key prefixes (the `secretKeyRef`/`prefix` shapes): defer until whole-object
  proves insufficient, or admit them in v1 contracts as optional fields left unimplemented?
- Skeleton staleness under rotation: is skeleton TTL enough, or does the operator need an explicit
  "rewarm now" action surfaced beside the panel?
- Actor attribution on binding mutations: rows have timestamps and pointer events; per-principal
  "who bound this" stamping should ride the Sealant-identity workstream — here or there?
- ConfigMap bindings in v1, or Secrets-only first? (Contracts above include both; with worker-side
  resolution the delivery machinery is shared, so the marginal cost of ConfigMaps is small.)
- Does `mend env show` on a cluster install ever want to list the bound object's **key names** (a
  cluster read Mend never holds), or is "contents unknown to Mend" the permanent, honest answer?

## Evidence index

- Mend env/secrets substrate:
  `packages/domain/src/workbench/{project-environment,project-secret}.ts`,
  `packages/db/src/schema/workbench.ts:264-268,357-397,579-584`,
  `packages/db/src/repos/{project-environment,project-secrets}.ts`,
  `packages/store/src/secret-cipher.ts`.
- Launch slot and manifest: `packages/sessions/src/engine.ts:1866-1952` (resolution + create),
  `:1914` (manifest), `:4057` (hot fingerprint — existing `references` field is dependency sources),
  `:2117-2154` (adoption carry).
- Routes/contracts/UI: `apps/api/src/routes/workbench.ts:857-1246`,
  `packages/api-contracts/src/project-environment.ts`,
  `apps/web/src/routes/projects.$projectId_.setup.tsx` (existing References panel at :129),
  `apps/cli/src/main.ts:1843-1964`.
- Platform env plumbing: `Core/packages/sdk/src/types.ts:256-285`,
  `Core/packages/validators/src/workspaces/workspace-blueprint.ts:255-267`,
  `Core/packages/workspaces/src/runtime/kubernetes/{names.ts:55-58 (per-workspace -env/-launch/-tls Secret names), manifests.ts:107-246,356-474 (:439 automount false; :367-368 per-run env Secret), adapter.ts:330-399 (:367 #ensureSecret, :396 launchSecret), config.ts:106-190,234-247}`,
  worker RBAC: Core deploy charts `rbac.yaml:58-60` / `sealant-worker.yaml:32-34` (secrets get,list
  namespace-wide),
  `Sealantd/crates/sealantd/src/boot/{config.rs:98,825-909 (passthrough scrub), mod.rs:208-268 (:224-240 secret_env injection; :227 redactor seeded from secret_env_file values only)}`.
- Deployment shape: `deploy/helm/mend/values.yaml:99-103`,
  `deploy/helm/mend/templates/networkpolicies.yaml:42-43`.
- Precedent decisions: MEND-AGENT-WORKBENCH-PLAN.md §15 (never record secret values), §16.4 (status
  language), §17 2026-08-01 (`reference` = dependency-source noun), :1382 (pass-through, never
  stored), :1481-1489 (explicit opt-in, never "mount everything"), :1399-1409 (no home-directory
  scanning); PLATFORM-FEEDBACK.md:89-93 (create-time inputs are fixed; no mutation surface — which
  makes create-time binding the only shape, and the right one) and the 2026-07-25 entry (reject at
  create time, not in a failed build job).

---

## Applied companions

The decision-log entry lives in MEND-AGENT-WORKBENCH-PLAN.md §17 (2026-08-25) and the platform ask
in PLATFORM-FEEDBACK.md (2026-08-25) — both applied from this plan, source of truth there.

## Appendix: prospect discovery survey

The plan's milestones assume facts about the target cluster. This survey answers them with read-only
commands (`get`/`list`/`auth can-i` only; secret NAMES only, never values) a prospect can run with
their normal dev kubeconfig — an RBAC denial is itself an answer. Skim output before sharing; names
alone can be internal.

```sh
# 1. Cluster basics: version, node arch (image platforms), provider
kubectl version 2>/dev/null | head -2
kubectl get nodes -o custom-columns='NAME:.metadata.name,ARCH:.status.nodeInfo.architecture,VERSION:.status.nodeInfo.kubeletVersion' --no-headers
kubectl get nodes -o jsonpath='{.items[0].spec.providerID}{"\n"}' 2>/dev/null

# 2. Which secret-sync layer exists (decides how Cluster bindings get their objects)
kubectl get crd 2>/dev/null | grep -iE 'external-secrets|secretstore|sealedsecret|secrets-store|vault' || echo "none of the common secret-sync CRDs"
kubectl get clustersecretstores,secretstores -A 2>/dev/null
kubectl get externalsecrets -A --no-headers 2>/dev/null | wc -l | xargs echo "ExternalSecrets total:"

# 3. GitOps layer
kubectl get crd 2>/dev/null | grep -E 'argoproj|fluxcd' | head -5
kubectl get applications.argoproj.io -A --no-headers 2>/dev/null | wc -l | xargs echo "Argo apps:"

# 4. The dev namespace's env shape — NAMES AND TYPES ONLY (replace "dev")
kubectl get secrets -n dev --no-headers 2>/dev/null | awk '{print $1, $2}'
kubectl get configmaps -n dev --no-headers 2>/dev/null | awk '{print $1}'

# 5. Cloud identity for pods (IRSA/Workload Identity — the ServiceAccount grant path)
kubectl get sa -A -o json 2>/dev/null | grep -c 'eks.amazonaws.com/role-arn' | xargs echo "ServiceAccounts with IAM roles:"

# 6. Storage: an RWX-capable class must exist (the store claim is ReadWriteMany)
kubectl get storageclass
kubectl get crd 2>/dev/null | grep -iE 'efs|longhorn|cephfs' || true

# 7. NetworkPolicy: does the CNI enforce (Mend's tier policies depend on it)?
kubectl get netpol -A --no-headers 2>/dev/null | wc -l | xargs echo "NetworkPolicies:"
kubectl get pods -n kube-system --no-headers 2>/dev/null | grep -oiE 'cilium|calico|flannel|aws-node|weave' | sort -u

# 8. What the operator's own access can do ("no" is an answer)
kubectl auth can-i create namespace
kubectl auth can-i create deployments -n dev
kubectl auth can-i get secrets -n dev

# 9. Local dev loop (run on the laptop, in a repo)
tilt version 2>/dev/null || echo "no tilt"
ls Tiltfile skaffold.yaml docker-compose.yml 2>/dev/null
```

Reading the answers: §2 with ESO CRDs present means bindings ride the operator's existing sync —
zero provider work. §4's names seed the operator's binding set. §6 is a hard install prerequisite
(EFS CSI on EKS). §5 tells whether ServiceAccount grants are the identity path. §7 decides whether
the chart's NetworkPolicies enforce. §1's arch is covered by the published amd64+arm64 images.

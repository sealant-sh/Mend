# Packaging plan — `pnpm i -g @sealant/mend` → `mend setup`

Written 2026-08-31. Replaces the curl-pipe install.sh as the front-door install. The single-host
product ships as **one compose project driven by the Mend CLI**: the user installs one npm package,
answers one network question, and Docker Desktop / OrbStack shows one collapsible `mend` group.

Decision log for this plan lives in this file. The audits behind the Core items (RabbitMQ usage,
registry usage) were verified against Core source on 2026-08-31; file references below are from
those audits.

## End state

```
pnpm i -g @sealant/mend
mend setup          # choose runtime (docker/orbstack now, k8s later), answer the network question
```

Containers, all under compose project `mend` (one group in Docker Desktop / OrbStack):

| container      | image                                  | notes                                  |
| -------------- | -------------------------------------- | -------------------------------------- |
| mend           | ghcr.io/sealant-sh/mend                | api + web, MEND_MODE=all               |
| sealant-api    | ghcr.io/sealant-sh/sealant-api         |                                        |
| sealant-worker | ghcr.io/sealant-sh/sealant-worker      | only holder of the Docker socket       |
| ssh-gateway    | ghcr.io/sealant-sh/sealant-ssh-gateway | no Docker socket, by design            |
| postgres       | postgres:17-alpine                     | one instance, two databases            |
| _(migrate)_    | one-shot, exits                        | both migrators, before anything serves |

Interim only, until the Core items land: rabbitmq and zot ride along via the same template and are
deleted from it release by release. Workspace containers appear as siblings while sessions run, as
today. No sealant-web (Mend is the login).

## Decisions locked

1. **Ship containers, not host processes.** A host-process/npm-vendored design was worked through
   and rejected: containers behave identically on Linux / Docker Desktop / OrbStack, keep the
   worker-vs-gateway socket boundary, and need no supervisor story (no launchd/systemd units). The
   only host-side software is the CLI itself.
2. **One Postgres, two databases** (`mend`, `sealant_control_plane`). Compose wiring only.
3. **RabbitMQ is dropped everywhere, k8s included.** It is a wake-up doorbell over jobs whose state,
   claims, leases and retries already live in Postgres. Two queue backends means permanent drift; pg
   SKIP LOCKED claims are already the multi-replica correctness story. (Core item 1.)
4. **Registry is a property of the runtime adapter.** Docker driver: no registry — images stay in
   the daemon's store. Kubernetes / Cloudflare: zot stays (build node ≠ run node; kubelet pulls per
   node). (Core item 2.)
5. **The sockets dir becomes a named volume**, never a host path. This is what unblocks macOS: the
   volume lives inside Docker's Linux VM, gateway/worker/workspaces share it natively, and the
   mac↔VM file share (which cannot carry unix sockets) is never involved. (Core item 3.)
6. **Runtime choice = Docker context.** `mend setup` offers docker / orbstack / kubernetes. Docker
   and OrbStack are the same driver — the choice selects and persists a context
   (`docker context ls`; OrbStack registers `orbstack`). Kubernetes prints "use the helm chart"
   until wired. Everything talks to Docker via the CLI + contexts; **no code ever hardcodes a socket
   path**. Podman: explicitly unsupported.
7. **One network-identity question at setup** — "Where will you connect from? this machine / my
   tailnet (detected: <MagicDNS name>) / my LAN (detected: <ip>)" — and every knob that today is an
   independently-guessed env var becomes a projection of the answer: bind host, advertised web URL +
   QR, auth trusted origins, `WORKSPACE_SSH_GATEWAY_HOST`. Env vars remain as machine- readable
   output that setup writes; humans never edit them. Re-runnable (`mend setup` again).
8. **Reachability is tested, not assumed.** After up: dial the advertised address:port from the
   non-loopback side; print "reachable at …" or the one-line platform fix (e.g. firewalld on Fedora,
   macOS app-firewall prompt). `mend doctor` re-checks. Defaults elsewhere (Debian/Arch/ Ubuntu,
   stock macOS) need no user action; Tailscale path bypasses firewalls entirely.
9. **Auth origins validated per request, not snapshotted at boot.** Today
   `packages/auth/src/auth.ts:54-66` enumerates interfaces once at startup — blind inside a
   container (sees 172.x) and stale after DHCP/tailscale changes; this is the signup-CORS bug.
   Accept origins whose port is the configured web port with the host checked dynamically, seeded by
   setup's computed addresses.
10. **VS Code path is the gateway, one port.** Remote-SSH connects
    `ws-<id>@<advertised-host> -p 2222`; gateway bridges sftp + direct-tcpip into the workspace
    (designed-in: Core `apps/ssh-gateway/src/gateway-server.ts:508`). 2222 is the single front door
    for every workspace; LAN/tailnet reachability only, never internet. Polish later: ssh-config
    Include + `vscode://vscode-remote/ssh-remote+…` deep links from web/CLI.

## Work items

### Core 1 — pg queue replaces RabbitMQ

Largely pre-built: `oci_image_build_jobs` already has status/lease/attempt columns and a correct
`FOR UPDATE SKIP LOCKED` claim (`packages/db/src/repositories/workspace-build-jobs.ts:342`); the
worker already runs a 30s reaper poll; code comments name "the pg-boss migration (Stage 4)" as the
destination. Scope:

- API side: swap three `Layer.succeed` publisher bodies
  (`apps/api/src/services/control-plane-capabilities.ts:77-91`) + the build-job publisher. No route
  changes.
- Worker side: replace the three `consume*Jobs` calls in `apps/worker/src/workers/workspaces.ts`
  with pollers; handler bodies (`{message, ack, nack}`) reuse verbatim. Independent pollers also fix
  the shared-channel prefetch bug (build jobs currently block run-exec/stop on a worker).
- Add claim tables for run-exec and lifecycle (build jobs have one); both already have durable
  anchors designed for lost-message convergence. DLQ semantics → `failed` terminal state via
  existing `attemptCount/maxAttempts`. LISTEN/NOTIFY optional latency polish.
- Delete `packages/rabbitmq` (371 LOC), both amqplib deps, the compose services, and
  `deploy/helm/sealant/templates/rabbitmq.yaml`.

### Core 2 — local image mode for the Docker runtime

Launch never resolves against the registry (refs are opaque strings passed verbatim to `docker run`;
e2e already proves the local-tag case). Scope:

- New `RegistryClient` implementation beside `packages/workspaces/src/registry/client.ts`:
  `publishOciImage` = keep `docker load` + the per-job `docker tag` (load-bearing: build tags are
  shared per OS family), drop the push, identity from `docker image inspect --format '{{.Id}}'`;
  `headManifest` via inspect (keeps the plan-hash reuse short-circuit, already fail-soft).
- Selection where the Docker builder path already forks (`REGISTRY_MODE=local|remote` or empty
  `REGISTRY_BASE_URL` ⇒ local) at `apps/worker/src/workers/workspaces.ts:70-75` and
  `apps/api/src/lib/create-registry-client.ts`.
- **Ship a tag reaper with it, not later**: there is no application-level GC anywhere today; in
  local mode unbounded growth moves into the daemon's image store where a user's
  `docker system prune` can delete live workspace images. Reap per-job `sdk-<uuid8>` tags keyed off
  terminal build jobs.
- k8s/Cloudflare untouched (registry mandatory there).

### Core 3 — sockets dir as a named volume (the macOS unblocker)

- Compose template: named volume instead of the `/run/sealant/sockets` host bind; worker rw, gateway
  ro.
- Docker runtime adapter: workspace containers mount only their own subdirectory via
  `--mount type=volume,volume-subpath=<container>` (requires Docker Engine ≥ 26 — acceptable floor,
  checked by doctor).
- Removes install.sh's macOS hard-block and the root-owned host dir on Linux.

### Mend 4 — `mend setup` + generated compose

- Template ships inside the npm package with image tags pinned at publish (the Mend↔Sealant version
  pin is the template). Generated into `~/.config/mend/compose.yaml`; secrets into `server.env`,
  append-if-absent (install.sh's exact contract, so existing installs carry over).
- Flow: choose runtime/context → network-identity question → generate →
  `docker compose -p mend up -d --wait` → reachability self-test → print URL + `mend pair` QR hint.
  Compose itself is the convergence engine (recreates only changed containers); re-running setup
  repairs.
- Day-2: `mend server status|logs|restart|down [--destroy-data]` as thin compose wrappers. Upgrade =
  `pnpm i -g @sealant/mend@latest && mend setup`. Boot persistence = `restart: unless-stopped` +
  Docker Desktop/OrbStack starting at login; no units anywhere.
- Doctor: capability checks, not brand checks (`docker version`, context shown, engine ≥ 26, smoke
  `docker run --rm`, reachability re-test).

### Mend 5 — dynamic trusted origins

Per decision 9: replace the boot-time interface snapshot in `packages/auth/src/auth.ts` with
per-request validation (port = web port; host checked dynamically against setup-seeded allowance).
Fixes signup-CORS for LAN/tailnet, container blindness, and address churn in one move.

### Mend 6 — install.sh shrinks to a bootstrap

Check/install node + pnpm, `pnpm i -g @sealant/mend`, exec `mend setup`. (Optional immediate patch
before the redesign: print the collected tailnet/LAN addresses instead of `localhost` at
`install.sh:536` and feed them into APP_URL/origins — the current installer prints an address only
the machine itself can use.)

## Sequencing

`mend setup` (items 4–6) does not wait on Core: on day one the template includes rabbitmq + zot;
each Core release deletes a service from the template. Suggested order:

1. Mend 4 + 5 + 6 — the install story, immediately shippable, Linux-first.
2. Core 3 — sockets volume; flips macOS from blocked to supported. Mac e2e here (incl. OrbStack and
   a VS Code Remote-SSH connect from a second machine).
3. Core 1 — pg queue (biggest Core item; also a k8s/helm simplification).
4. Core 2 — local image mode + tag reaper.
5. Later: k8s option in setup (wraps the existing helm chart), ssh-config Include, VS Code deep
   links.

## Open questions / risks

- Postgres major upgrades: image stays pinned to 17; add `mend server pg-upgrade` when it matters.
  Never automatic.
- Migration from existing install.sh installs (host Mend server + separate sealant compose project):
  setup should detect the old layout and adopt/replace it deliberately — needs a small design pass
  of its own.
- Docker Engine ≥ 26 floor (volume-subpath): fine for Docker Desktop/OrbStack; verify against the
  oldest distro-packaged engines we care about.
- better-auth's support for dynamic origin validation (function vs static array) decides the
  implementation shape of Mend 5.

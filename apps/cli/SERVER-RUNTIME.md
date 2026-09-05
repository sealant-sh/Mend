# Server persistence and runtime contract

Setup and the upcoming lifecycle commands share one installation directory, normally
`$XDG_CONFIG_HOME/mend` or `~/.config/mend`. This layout replaces the unreleased flat setup layout.
It does not migrate a flat installation or generate replacement credentials for one.

## Layout

```text
mend/
  server.lock/owner.json           # PID, hostname, random ownership token; present while busy
  identity.env                    # write-once installation credentials
  active -> generations/gen-UUID  # the only deployment commit point
  generations/
    gen-UUID/
      identity.env                # exact copy of the installation identity
      server.json                 # pin, context, endpoint, socket source, exposure
      server.env                  # complete Compose interpolation inputs plus credentials
      compose.yaml
      postgres-init.sh
```

Directories are private, mode `0700`. Credentials and config files are `0600`, including
`identity.env`, `server.env`, `server.json`, and `compose.yaml`. The public `postgres-init.sh` is
`0755`, even under a `077` umask. It contains only environment references, not credential values,
and Compose bind-mounts that file read-only. The official `postgres:17-alpine` entrypoint runs it as
the container's `postgres` user, UID 70, not the host owner. Mode `0700` denies that user access.
The individual file mount does not expose its private host parent directories.

Generation immutability is an application rule: Mend never rewrites a generation. The owner can
still edit files, so reads validate config, secrets, identity consistency, and the asset contract.
Backups must protect these credentials and include the Docker volumes. Do not log raw store files.
`readServerInstallation` returns only parsed configuration and the immutable directory path.

## Transaction and recovery

`withServerStore(configDir, callback)` acquires the exclusive `server.lock` directory before any
installation reads, secret generation, or Docker calls. It holds ownership until the callback
finishes, including Compose and health checks. Other processes fail with owner and recovery
information. Handles cannot be used after release. Cleanup checks directory identity and the owner
token and never recursively deletes a lock.

No lock is automatically stolen. After a killed command, verify that the recorded process on the
recorded host **and its Docker Compose children** have stopped. Only then move `server.lock` aside
and retry. An unreadable owner, foreign host, reused PID, or inaccessible process is not proof of a
stale lock. Do not remove `identity.env`, `active`, generations, or volumes to recover a lock.

`ServerStore.prepare(files)` performs these steps while locked, without changing `active`:

1. Refuse an identity different from the saved identity.
2. Return the active generation unchanged when all file contents match and `postgres-init.sh` has
   mode `0755`. Incompatible init permissions require a new immutable generation, even for identical
   contents. Preserve the saved identity, old generation bytes and modes, and active pointer until
   activation. Never repair permissions by changing a retained generation.
3. On the first preparation, write and fsync a private identity file, then publish it using an
   exclusive hard link. Never rename over an existing identity. Fsync the installation directory.
4. Write the full generation with exclusive file creation. Fsync each file, the generation
   directory, its parent, and the installation directory.

`ServerStore.activate(generation)` checks that the retained generation belongs to this installation
and still contains the complete prepared files. It creates a temporary relative symlink, atomically
renames it over `active`, then fsyncs the installation directory. `commit(files)` remains the
combined prepare-and-activate operation for callers that need it.

Setup prepares first, runs read-only `docker compose config --images` against that exact generation,
then inspects the canonical images. Online setup pulls missing images explicitly and inspects them
again. Only after all image checks pass does setup activate and start Compose. Both online and
offline startup use `--pull never --no-build`, so startup cannot replace a checked image by pulling
or building. Image rejection leaves any old active generation and running containers untouched.

The Docker ownership claim integration point is after durable preparation and read-only config
checks, before image checks that may pull. Ownership claims and registry probes are separate work;
this change does not implement them.

An interruption before activation leaves the old active generation intact. On first installation,
the independently saved identity survives even if no generation was activated. Rerunning uses that
identity without generating credentials again. Each registry probe still draws a fresh nonce.
Partial generations and temporary files are retained, never selected implicitly or removed
automatically. Missing or corrupt identity with existing state is an error, not permission to
regenerate credentials.

An interruption after activation leaves a complete selected generation. Compose or health failure
also retains it. Retrying `up` uses the same project, volumes, pin, and credentials. There is no
claim that the filesystem transaction and Docker startup are atomic together.

### Partial Postgres initialization

The official Postgres image runs init scripts only for an empty data directory. The old `0700`
script could fail with `Permission denied` after `initdb` had already written `PG_VERSION`. A retry
can then skip initialization while the `mend` or `sealant` role and its database are still missing.
A healthy Postgres process alone does not establish that either application database exists.

Rerunning setup with the fixed CLI prepares a `0755` generation using the same credentials. It does
not reset Postgres, restore a backup, or automatically replay the init script against existing data.
Retain all database contents, even when the first initialization failed.

Manual recovery requires an operator:

1. Confirm the saved Docker context, installation identity, and owned Postgres container. Inspect
   its logs for the init failure. Keep `identity.env` and all generations.
2. Stop application writers and take a database backup or a consistent volume snapshot before
   changing database state. Do not remove volumes, clear `PGDATA`, or delete `PG_VERSION` to force
   initialization.
3. Inspect both roles and databases as the existing Postgres administrator. If bootstrap is
   incomplete, review the new generation's init script and explicitly run it inside that owned
   Postgres container with the saved administrator and application password environment. The script
   creates missing roles/databases and sets role passwords; it does not repair an existing
   database's ownership or migrate application schemas. Resolve any such conflicts separately.
4. Verify password-authenticated connections as `mend` to `mend` and as `sealant` to
   `sealant_control_plane`, including database ownership, before restarting application writers. If
   the cluster itself cannot start, retain it and use operator-directed Postgres recovery.

This is a local POSIX-filesystem protocol for Linux/macOS, not a distributed lock. The Docker
ownership claim below rejects different identities targeting the same fixed `mend` project and
canonical volumes. Keep one configuration directory per daemon. Copies of the same identity pass
ownership verification but do not share a filesystem lock; do not operate those copies concurrently.

## Lifecycle integration

Use these existing owners rather than duplicating setup internals:

- `server-store.ts`: `withServerStore`, `ServerStore.readIdentity`, `readActive`, `prepare`,
  `activate`, and `commit`. Store operations and the lock callback return `ServerStoreResult`
  values. Keep all operations on an installation, including start/stop/status/logs/upgrade, inside
  this lock scope.
- `server-setup.ts`: `readServerInstallation(store)` validates the active deployment and returns
  `{ config, directory }` or ordinary absence. `nodeServerSetupRuntime()` captures the host
  environment once and provides the real process and HTTP implementations.
- `server-runtime.ts`: `serverComposeArgs({ directory, dockerContext }, command)` supplies the
  explicit context, project `mend`, project directory, env file, and Compose file. Always pass the
  immutable directory from the selected generation, not the moving `active` symlink.
  `runServerProcess` is the controlled child-process implementation. Every command defaults to a
  30-second deadline. `{ timeoutMs }` selects a finite operation-specific budget. Expiry sends
  SIGKILL to the child's owned POSIX process group and waits for `close` to reap the direct child
  and drain inherited pipes before returning. Descendants cannot keep running after the caller
  releases its lock. The host init reaps orphaned descendants. Captured stdout is bounded to 4 MiB
  and stderr to 64 KiB; overflow terminates the group and returns failure. Setup allows ten minutes
  for online image pulls plus three minutes for startup, or just three minutes offline. Compose also
  receives `--wait-timeout 120`.
- `server-docker-volumes.ts`: setup calls
  `claimServerDockerVolumes(runtime, { dockerContext, identityBytes })` with
  `Buffer.from(generation.files.identity)` after committing the complete generation, before any
  Docker mutation other than the claim itself or any Compose deployment command. Read-only
  capability checks and offline image inspection can precede persistence.
- `server-registry-probe.ts`: after Compose and app health, setup calls
  `probeServerRegistry(runtime, { dockerContext, registryPort, nonce: runtime.randomBytes(24).toString("hex"), temporaryDirectory: path.resolve(runtime.configDir) })`.
  Print all `cleanupWarnings` on either result. An `error` blocks the reachable/setup-success
  message and keeps the installation for retry.

### PR5 handoff

This change wires setup only. The parent lifecycle work must call `verifyServerDockerVolumes` while
holding `withServerStore`, after validating the selected installation and reading its persisted
identity, before lifecycle Compose commands. Pass the saved context and exact `identity.env` bytes.
Treat absent identity or either absent volume as an error. Never use the claim helper as a fallback
from start, stop, status, logs, or upgrade.

In `startInstallation`, call `probeServerRegistry` after app health and before reporting success,
with the same arguments and warning/error handling as setup above. Every start gets a fresh nonce.
The runtime must forward probe deadlines, not discard the third `run` argument. Ownership helpers
return tagged results and never log credentials; the registry helper returns tagged results plus
cleanup warnings. No PR5 lifecycle commands or upgrade policy are implemented here.

Low-level store file values are private serialized bytes. A future upgrade must parse and render its
complete proposed config/env pair before `prepare`, preserve `identity`, and perform its own upgrade
policy checks before `activate`. The store enforces identity continuity and atomic publication; it
does not interpret application versions or orchestrate rollback. Retaining old files is not proof
that a previous application version can run against newer database contents.

The extraction keeps filesystem ownership and publication in `server-store.ts`, process policy in
`server-runtime.ts`, and setup decisions/validation in `server-setup.ts`. The previous private
four-file writer could not safely be reused by lifecycle commands.

## Docker and health

The process environment is an allowlist: `PATH`, `HOME`, `USER`, `LOGNAME`, `XDG_CONFIG_HOME`,
`XDG_RUNTIME_DIR`, `DOCKER_CONFIG`, `SSH_AUTH_SOCK`, `TMPDIR`, `TMP`, and `TEMP`. All interpolation
variables, `COMPOSE_*`, `DOCKER_HOST`, `DOCKER_CONTEXT`, and `DOCKER_API_VERSION` from the shell are
excluded. Docker configuration files and explicitly selected contexts still supply connectivity and
credential helpers. Commands use argv arrays, never a shell. Changing a shell variable is not an
upgrade or exposure mechanism.

Linux Docker Desktop is identified from the selected daemon's `OperatingSystem`, with the standard
`desktop-linux` context also recognised. Desktop and macOS runtimes mount the daemon-side
`/var/run/docker.sock`, not the host context proxy. Local Linux Engine uses its Unix endpoint.
Detected sockets are recalculated on reruns. An explicit `--docker-socket` is recorded as an
override and retained unless the context is replaced or another override is supplied. Docker Desktop
acceptance depends on an actual Engine registry roundtrip, not an operating-system heuristic.

Before activation, the resolved Compose images must be exactly `ghcr.io/sealant-sh/mend:VERSION` and
`postgres:17-alpine`. The Mend image must carry `org.opencontainers.image.version` equal to the
requested pin, even for online setup and even after a pull. A cached wrong label is rejected, not
silently replaced. Asset text checks alone do not establish what Compose will run.

Success requires a 2xx `/api/health` response containing JSON with `status: "ok"` and `version`
exactly matching the saved pin, followed by a successful Engine registry roundtrip. Extra health
fields are allowed. HTML, malformed JSON, missing fields, wrong versions, or registry failure never
produce a reachable-version claim.

### Docker data ownership

The anchor is `mend-store`. Its immutable `dev.sealant.mend.installation` label is the SHA-256 of
the exact persisted `identity.env` bytes. Setup lists resources successfully before concluding
absence, refuses unowned legacy Mend data, and creates the anchor with that label. Docker's atomic
named create preserves the first writer's labels; setup inspects afterward to establish ownership.
Only then may it claim `mend-control` with the same label. Matching retries do not recreate volumes.
Mismatches, missing labels, failed inspections, and malformed replies stop setup. Restore the
original configuration or choose a clean daemon; never delete or relabel existing data to proceed.

Both canonical volumes must be `external: true` in the release Compose template with their canonical
name substitutions. Setup validates that contract on downloaded, supplied, and retained assets
before Docker mutations. It accepts the release template's explicit declarations, not arbitrary
user-authored YAML. Compose owns the remaining volumes as before. Labels establish identity
continuity, not a mutex or protection against an administrator editing Docker state.

### Registry roundtrip and cleanup

The probe imports a tiny nonce-labelled image, pushes to
`127.0.0.1:REGISTRY_PORT/mend-registry-probe/NONCE:probe`, removes the local tag, pulls it back, and
checks both the image ID and nonce label. No build tool or external base image is needed. Each
command has a 60-second budget; cleanup commands have 15 seconds. The tar is mode `0600` inside a
private `0700` temporary child of `configDir`. The helper removes that child on success and failure.
Local tag cleanup verifies ownership first and never uses force, prune, or image-ID deletion.
Cleanup warnings do not hide the primary failure. The tiny remote manifest remains because bundle
manifest deletion is disabled; the probe never changes registry configuration or widens its binding.

The guard modules own Docker protocol parsing and resource cleanup rather than putting those
mechanics into setup or duplicating them in lifecycle commands. Existing setup's exception handling
remains confined to its command/store boundary; the new helpers expose expected failures as values.
Error fields use explicit declarations so the existing Node strip-only child tests can import them.

## Reproduce the checks

```sh
pnpm --filter @sealant/mend exec vitest run src/server-setup.test.ts src/server-store.test.ts src/server-runtime.test.ts src/server-docker-volumes.test.ts src/server-registry-probe.test.ts
pnpm --filter @sealant/mend exec vitest run --testTimeout=15000
# Opt-in real Engine checks use unique test names, never the standard Mend resources:
MEND_DOCKER_TEST_CONTEXT=default pnpm --filter @sealant/mend exec vitest run src/server-docker-protocol.test.ts
# Preload official postgres:17-alpine in a local daemon that can bind-mount this worktree's temp files:
MEND_DOCKER_TEST_CONTEXT=default pnpm --filter @sealant/mend exec vitest run src/server-postgres-bootstrap.test.ts
pnpm --filter @sealant/mend typecheck
pnpm --filter @sealant/mend lint
pnpm format:fix
```

Tests spawn separate setup processes, kill an owner, impose a real kernel file-size limit and
terminate after a partial write, exercise write-permission failures, retain earlier generations, and
compare saved credentials across retries. Real HTTP listeners test the health response body. The
Compose test launches the production runtime in a separate process with a poisoned environment and
uses `docker compose config --format json`. Public-command rejection tests use real
`docker compose config --images` with wrong Mend pins, unexpected images, and wrong OCI labels in
online and offline setup. Process-edge fakes record pulls and starts and verify the old active
generation remains selected until image checks pass. These tests need the Compose plugin, but no
daemon or containers, and are explicitly skipped if the plugin is absent.

Public `serverCommand` tests share `test-fixtures/docker-protocol.ts`, a stateful Engine protocol
fixture with immutable named-volume labels and distinct local/remote image tags. They check
persist-before-mutation ordering, cross-config identity rejection, same-identity retries,
corruption, private probe files, fresh nonces, registry failures, and cleanup warnings without
mocking modules. The separate opt-in Docker tests check atomic claims, competing identities, and a
real loopback registry roundtrip. The separate official-Postgres test mounts the store-generated
init file read-only, uses a uniquely named and labelled container with tmpfs data and no published
ports, and checks password-authenticated connections and ownership for both databases and roles. It
creates the container before starting it, verifies its ownership label, and cleans up only the
acquired container ID. It never uses canonical Mend resources or removes the cached image. Store
regressions also cover a `077` umask and same-content retries with incompatible init modes. The full
CLI suite needs a 15-second test budget for existing login polling.

`test-fixtures/docker` copies the Compose and ownership contract from
`../Mend-packaging/deploy/docker` at `91e1cf6`; Postgres init is unchanged from `1c2018b`. These are
test inputs, not shipped CLI assets. Setup downloads the two assets from the selected GitHub release
unless `--assets-dir DIR` supplies `compose.v1.yaml` and `postgres-init.sh`. Supplied files pass the
same contract checks and are copied into the private generation. The source directory is not
retained or needed on reruns. Fresh setup with local assets requires an explicit `--version`.

`--offline` forbids GitHub requests and runs Compose with `--pull never --no-build`. Preload both
`postgres:17-alpine` and `ghcr.io/sealant-sh/mend:VERSION` in the selected daemon. The Mend image's
`org.opencontainers.image.version` label and the health response must equal the exact pin. Local
health and Engine loopback registry probes still run. Offline setup never pulls release images, but
does push/remove/pull its own tiny local registry probe. This flag controls installation network
access, not the running server's workspace/provider traffic.

`--registry-port` persists the loopback registry port, default `5000`. App, SSH and registry ports
must be valid and distinct. For a host already running Sealant's registry, choose a free port:

```sh
mend server setup --version 0.23.0 --assets-dir ./release-assets --offline --registry-port 5501
mend server setup --offline
```

No release upload, image build, or live deployment acceptance is included in these unit checks.

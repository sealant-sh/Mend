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

Directories are private, mode `0700`. Files are `0600`, except `postgres-init.sh`, mode `0700`.
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
2. Return the active generation unchanged when all files match.
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
identity without calling the random source again. Partial generations and temporary files are
retained, never selected implicitly or removed automatically. Missing or corrupt identity with
existing state is an error, not permission to regenerate credentials.

An interruption after activation leaves a complete selected generation. Compose or health failure
also retains it. Retrying `up` uses the same project, volumes, pin, and credentials. There is no
claim that the filesystem transaction and Docker startup are atomic together.

This is a local POSIX-filesystem protocol for Linux/macOS, not a distributed lock. Use one
installation directory per daemon. Separate configuration directories do not coordinate ownership of
the fixed `mend` Compose project and canonical volumes.

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
  `runServerProcess` is the controlled child-process implementation.

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
override and retained unless the context is replaced or another override is supplied. No speculative
Docker Desktop registry rejection is added here; actual deployment acceptance remains responsible
for exercising daemon-side registry connectivity.

Before activation, the resolved Compose images must be exactly `ghcr.io/sealant-sh/mend:VERSION` and
`postgres:17-alpine`. The Mend image must carry `org.opencontainers.image.version` equal to the
requested pin, even for online setup and even after a pull. A cached wrong label is rejected, not
silently replaced. Asset text checks alone do not establish what Compose will run.

Success requires a 2xx `/api/health` response containing JSON with `status: "ok"` and `version`
exactly matching the saved pin. Extra health fields are allowed. HTML, malformed JSON, missing
fields, and wrong versions never produce a reachable-version claim.

## Reproduce the checks

```sh
pnpm --filter @sealant/mend exec vitest run src/server-setup.test.ts src/server-store.test.ts src/server-runtime.test.ts
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

`test-fixtures/docker` copies the deployment contract's Compose and Postgres files from
`../Mend-bundle/deploy/docker` at `1c2018b`. These are test inputs, not shipped CLI assets. Setup
downloads the two assets from the selected GitHub release unless `--assets-dir DIR` supplies
`compose.v1.yaml` and `postgres-init.sh`. Supplied files pass the same contract checks and are
copied into the private generation. The source directory is not retained or needed on reruns. Fresh
setup with local assets requires an explicit `--version`.

`--offline` forbids GitHub requests and runs Compose with `--pull never --no-build`. Preload both
`postgres:17-alpine` and `ghcr.io/sealant-sh/mend:VERSION` in the selected daemon. The Mend image's
`org.opencontainers.image.version` label and the health response must equal the exact pin. Local
health probes still run. This flag controls installation network access, not the running server's
workspace/provider traffic.

`--registry-port` persists the loopback registry port, default `5000`. App, SSH and registry ports
must be valid and distinct. For a host already running Sealant's registry, choose a free port:

```sh
mend server setup --version 0.23.0 --assets-dir ./release-assets --offline --registry-port 5501
mend server setup --offline
```

No release upload, image build, or live deployment acceptance is included in these unit checks.

# Developing Mend

Product decisions live in `MEND-AGENT-WORKBENCH-PLAN.md`. This guide covers running source code; for
an installed server, use [`docs/SELF-HOSTING.md`](docs/SELF-HOSTING.md).

## Prerequisites

- Node.js and pnpm at the versions in `.node-version` and `package.json`. Nix/direnv supplies them.
- Docker for the development Postgres, unless you provide `DATABASE_URL`.
- A separately configured Sealant control plane for source development. Mend uses only its public
  SDK. The packaged application instead includes its pinned Sealant runtime.

## Source development

```sh
direnv allow
pnpm install
cp .env.example .env
# Set SEALANT_BASE_URL and, when required, SEALANT_SERVICE_KEY in .env.
pnpm --filter @mend/web dev
```

The development command loads the root `.env`, preserving explicit shell overrides. It starts the
Postgres from `compose.dev.yaml` when using the default database, then Vite on **3105** and the API
on **3101**. Nitro forwards `/api` HTTP requests to the API; Vite forwards WebSocket upgrades. The
production web entrypoint uses its own proxy instead. Open `http://localhost:3105`.

Database migrations run at API startup. Without a working Sealant connection, the web app can start
but session launches cannot. For host-side source development, the Sealant worker must be configured
to mount the store paths that this API uses; the production bundle's Docker-volume layout does not
configure an unrelated development control plane.

With dev running, check the auth proxy without creating accounts or sessions:

```sh
node --test apps/web/scripts/dev-auth.integration.mjs
```

The check sends empty signup/signin bodies and reads the anonymous session. Set `MEND_DEV_TEST_URL`
to test a different web origin. This catches HTML 404 responses from the app when requests should
reach the auth server.

## Environment

| Variable               | Default                                    | Purpose                                                                                   |
| ---------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `DATABASE_URL`         | `postgres://mend:mend@localhost:5434/mend` | Mend development database                                                                 |
| `SEALANT_BASE_URL`     | SDK default, `http://localhost:8080`       | Set to your development control plane; a local Sealant stack commonly publishes port 4000 |
| `SEALANT_SERVICE_KEY`  | unset                                      | Service principal on that control plane                                                   |
| `APP_URL`              | `http://localhost:3105`                    | Primary public origin, shared by API and web                                              |
| `MEND_ALLOWED_ORIGINS` | `[]`                                       | JSON array of additional exact HTTP(S) origins                                            |
| `BETTER_AUTH_SECRET`   | development constant                       | Supply a persistent random secret outside development                                     |
| `MEND_MODE`            | `all`                                      | API process mode: `all`, `api`, or `worker`                                               |
| `PORT`                 | `3101` for API                             | Internal API listener; not the public web URL                                             |

Origins must include the correct scheme, hostname, and port, without a path. Interface discovery,
wildcards, and incoming forwarding headers do not grant trust. Do not configure a second allowlist
through `BETTER_AUTH_TRUSTED_ORIGINS`.

These are source-development inputs. The installed CLI generates and preserves its own server
configuration; shell environment overrides do not change a saved installation.

## Work through a session

1. Create an account and inspect the Sealant connection in Settings.
2. Connect your own harness and Git credentials with `mend connect codex`, `mend connect claude`, or
   `mend connect github`. Mend does not supply model credentials.
3. Adopt a cloneable Git repository URL. Local folder and `file://` adoption are not supported.
4. Start a session, inspect its record and accumulated change, and send a follow-up to that session.
   A commit or pull request is optional publication, not the identity of the work.

## Build and verify

```sh
pnpm build                        # generates route trees needed by clean-checkout typechecks
pnpm exec turbo typecheck --force # tsgo; never tsc
pnpm exec turbo lint --force
pnpm exec turbo test --force
pnpm format:fix
node --test scripts/process-supervisor.test.mjs scripts/bundle-packaging.test.mjs \
  scripts/check-packaged-server.test.mjs scripts/release-publication.test.mjs \
  scripts/packaged-ssh-acceptance.test.mjs
```

The bundle-contract test needs the Docker Compose plugin, not a running daemon. Live bundle and
installed-CLI acceptance additionally need a Docker daemon; see `docs/MACOS-VALIDATION.md` for the
separate physical-device gates.

`pnpm-lock.yaml` is generated by pnpm, never hand-edited. Commit it with the manifest/catalog change
that produced it. Platform gaps belong in `PLATFORM-FEEDBACK.md`; never import Sealant internals.
Read `DESIGN.md` before non-trivial UI work.

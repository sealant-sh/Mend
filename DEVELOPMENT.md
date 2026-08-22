# Developing Mend

How to run Mend locally against a Sealant. Product decisions live in `MEND-AGENT-WORKBENCH-PLAN.md`
(canonical direction + decision log); the retired queue-era docs are in `docs/archive/`. This file
is just the mechanics.

## Prerequisites

- [direnv](https://direnv.net/) with Nix (recommended; entering the repository provides the pinned
  Node and pnpm versions from `flake.nix`)
- Or, when not using direnv: Node 26.7.0 and pnpm 10.32.1
- Docker (dev Postgres, and the Sealant stack if you run one locally)
- A running Sealant control plane (self-host stack lives in `~/.config/sealant` on a machine
  installed via Sealant's installer — `~/.sealant` on pre-XDG installs; version pinned by
  `SEALANT_VERSION` in its `.env`)

## Setup

```sh
direnv allow                               # first checkout only
pnpm install --lockfile=false              # pnpm-lock.yaml is intentionally not updated
cp .env.example .env                       # then point SEALANT_BASE_URL at your stack
pnpm --filter @mend/web dev                # Postgres (docker, 5434) + vite (3101) + the Effect server (3105)
```

The dev command is self-sufficient: it loads the root `.env` (explicit shell env wins), brings up
the dev Postgres via `compose.dev.yaml` (skipped when `DATABASE_URL` points elsewhere), and runs
vite and the Effect server together. Without `SEALANT_BASE_URL` it still boots — and warns that
session launches will fail against the SDK's `localhost:8080` default.

Open http://localhost:3101 (vite, proxies `/api` → 3105). Or build once
(`pnpm --filter @mend/web build`) and run only the server — it then serves the built app itself on
http://localhost:3105.

Migrations run automatically at boot. Sign-up is open on a fresh instance; the first account is
yours.

## Environment

All optional in dev — the defaults match `compose.dev.yaml` and a localhost Sealant:

| Variable                        | Default                                    | What                                                                                                                                                                                                                                                                                     |
| ------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                  | `postgres://mend:mend@localhost:5434/mend` | Product Postgres                                                                                                                                                                                                                                                                         |
| `SEALANT_BASE_URL`              | `http://localhost:8080`                    | Sealant control plane (a self-host stack serves **4000**)                                                                                                                                                                                                                                |
| `SEALANT_SERVICE_KEY`           | unset                                      | Mend's service key — one of the control plane's `SEALANT_SERVICE_KEYS`. Mend acts on behalf of each signed-in user under their own Sealant user, provisioned on first use (`docs/SEALANT-IDENTITY.md`). An open local stack needs none. `SEALANT_API_KEY` still works as the older name. |
| `MEND_MODE`                     | `all`                                      | `all` · `web` · `worker`                                                                                                                                                                                                                                                                 |
| `PORT`                          | `3105`                                     | The Effect server                                                                                                                                                                                                                                                                        |
| `APP_URL`                       | `http://localhost:3101`                    | better-auth origin — set to `http://localhost:3105` when serving the built app directly                                                                                                                                                                                                  |
| `BETTER_AUTH_SECRET`            | dev-grade constant                         | Generate for anything real: `openssl rand -base64 32`                                                                                                                                                                                                                                    |
| `MEND_INFERENCE_CLAUDE_ACCOUNT` | the account named `default`                | Which connected claude account inference uses                                                                                                                                                                                                                                            |
| `MEND_DISPATCH_INTERVAL`        | `5 seconds`                                | Dispatcher poll                                                                                                                                                                                                                                                                          |

Against a local self-host stack, put these in the root `.env` (loaded by `pnpm dev`; see
`.env.example`):

```sh
SEALANT_BASE_URL=http://localhost:4000
```

## The loop, locally

1. Settings → the Sealant connection check must be green ("Connected · observed").
2. Connect your own accounts: Settings → Connected accounts (web or desktop), or from a machine
   where the agent CLIs are logged in, `mend connect codex` / `mend connect claude` /
   `mend connect github` (`mend accounts` lists them). Each person's sessions and Mend's model calls
   run on their own subscription — Mend ships no model keys, and the Sealant web UI is not involved.
3. New issue → give it a **real, cloneable repository** → drag it into Queued. The dispatcher (5s
   poll) takes the top card into Mending; the card streams the recording live; a failed run returns
   to Triage carrying the failure.

## Production-shaped run

The supported production shape is what [`install.sh`](install.sh) builds — run it with
`MEND_DRY_RUN=1` to see every command without changing the machine:

- Sealant from `compose.selfhost.yaml` in `~/.config/sealant`, started with `--scale web=0`; its
  `.env` carries `SEALANT_SERVICE_KEYS` (Mend's key is the first entry), `SEALANT_CREDENTIALS_KEY`
  and `SEALANT_MOUNT_ALLOWED_STORE_ROOTS` (which must include Mend's store root).
- The Mend server on the host, not in a container: it owns the store path that Sealant bind-mounts
  into workspaces. A shallow clone at `~/.local/share/mend/src` (the `cli-v*` tag), built with
  `pnpm --filter @mend/web build`, run by `node apps/web/src/entry/main.ts` as a user service
  (`systemctl --user status mend` / `journalctl --user -u mend -f` on Linux; `dev.sealant.mend`
  under launchd on macOS). Config in `~/.config/mend/server.env` (0600): `DATABASE_URL`,
  `SEALANT_BASE_URL`, `SEALANT_SERVICE_KEY`, `BETTER_AUTH_SECRET`, `PORT` (3105), `APP_URL`,
  `MEND_STORE_ROOT`, `MEND_VERSION`, `NODE_ENV`, `PATH`.
- Mend's Postgres from `~/.config/mend/compose.yaml` (project `mend`, host port 5436 on loopback —
  5432–5434 are taken on dev machines).
- The CLI under a private npm prefix (`~/.local/share/mend/npm`), linked to `~/.local/bin/mend`.

`compose.yaml` at the repo root is the containerised alternative (the Mend image + Postgres, pointed
at your Sealant via `SEALANT_BASE_URL` / `SEALANT_SERVICE_KEY`; container listens on 3000, host port
via `MEND_PORT`). Two caveats: a loopback-bound Sealant is not reachable through
`host.docker.internal` (bind it wider or share a network), and the store lives inside the container,
so Sealant mounts need the same host path on both sides.

## Conventions & gotchas

- `pnpm typecheck` (tsgo) · `pnpm lint` · `pnpm format:fix` after changes · `pnpm test`.
- Never touch `pnpm-lock.yaml`; installs use `pnpm add --lockfile=false` (CI too, for now).
- Platform access only through `@sealant/sdk`; gaps go to `PLATFORM-FEEDBACK.md` — including
  release-artifact bugs found while dogfooding (two are filed against 0.5.0 there: the api image
  missing the Agent SDK native binary, and the ssh-gateway env break on upgraded installs).
- Design source of truth for any UI work: `DESIGN.md`.

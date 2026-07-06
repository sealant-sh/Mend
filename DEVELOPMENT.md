# Developing Mend

How to run Mend locally against a Sealant. Product decisions live in `MEND-PLAN.md` / `PRODUCT.md`;
architecture in `ARCHITECTURE.md`; this file is just the mechanics.

## Prerequisites

- Node ≥ 24 (the server runs the TypeScript sources directly — no build step outside `apps/web`)
- pnpm 10 (`corepack enable`)
- Docker (dev Postgres, and the Sealant stack if you run one locally)
- A running Sealant control plane (self-host stack lives in `~/.sealant` on a machine installed via
  Sealant's installer; version pinned by `SEALANT_VERSION` in `~/.sealant/.env`)

## Setup

```sh
pnpm install
docker compose -f compose.dev.yaml up -d   # Postgres on localhost:5433 (project: mend-dev)
pnpm --filter @mend/web dev                # vite (3101) + the Effect server (3105), together
```

Open http://localhost:3101 (vite, proxies `/api` → 3105). Or build once
(`pnpm --filter @mend/web build`) and run only the server — it then serves the built app itself on
http://localhost:3105.

Migrations run automatically at boot. Sign-up is open on a fresh instance; the first account is
yours.

## Environment

All optional in dev — the defaults match `compose.dev.yaml` and a localhost Sealant:

| Variable                        | Default                                    | What                                                                                                                                                                                                                                                                 |
| ------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                  | `postgres://mend:mend@localhost:5433/mend` | Product Postgres                                                                                                                                                                                                                                                     |
| `SEALANT_BASE_URL`              | `http://localhost:8080`                    | Sealant control plane (a `~/.sealant` stack serves **4000**)                                                                                                                                                                                                         |
| `SEALANT_API_KEY`               | unset                                      | Bearer for authenticated deployments                                                                                                                                                                                                                                 |
| `SEALANT_OWNER_USER_ID`         | SDK default (`usr_local`)                  | **Must be the user id your Sealant web UI writes connected accounts under**, or inference/workspaces see nothing. Find it: `SELECT owner_user_id FROM connected_accounts` in Sealant's `sealant_control_plane` DB. Pre-auth wart; goes away when Sealant auth lands. |
| `MEND_MODE`                     | `all`                                      | `all` · `web` · `worker`                                                                                                                                                                                                                                             |
| `PORT`                          | `3105`                                     | The Effect server                                                                                                                                                                                                                                                    |
| `APP_URL`                       | `http://localhost:3101`                    | better-auth origin — set to `http://localhost:3105` when serving the built app directly                                                                                                                                                                              |
| `BETTER_AUTH_SECRET`            | dev-grade constant                         | Generate for anything real: `openssl rand -base64 32`                                                                                                                                                                                                                |
| `MEND_INFERENCE_CLAUDE_ACCOUNT` | the account named `default`                | Which connected claude account inference uses                                                                                                                                                                                                                        |
| `MEND_DISPATCH_INTERVAL`        | `5 seconds`                                | Dispatcher poll                                                                                                                                                                                                                                                      |

Example against a local `~/.sealant` stack:

```sh
SEALANT_BASE_URL=http://localhost:4000 \
SEALANT_OWNER_USER_ID=<your sealant web user id> \
pnpm --filter @mend/web dev
```

## The loop, locally

1. Settings → the Sealant connection check must be green ("Connected · observed").
2. For real mends: connect a Claude account in the Sealant web UI (`/settings/connected-accounts`,
   paste a `claude setup-token` token). Inference and harness runs both bill your subscription —
   Mend ships no model keys.
3. New issue → give it a **real, cloneable repository** → drag it into Queued. The dispatcher (5s
   poll) takes the top card into Mending; the card streams the recording live; a failed run returns
   to Triage carrying the failure.

## Production-shaped run

`docker compose up` (see `compose.yaml`): the Mend image + Postgres, pointed at your Sealant via
`SEALANT_BASE_URL` / `SEALANT_API_KEY` / `SEALANT_OWNER_USER_ID`. Container listens on 3000; host
port via `MEND_PORT`. Note: a loopback-bound Sealant (`SEALANT_BIND_HOST=127.0.0.1`, the installer
default) is not reachable through `host.docker.internal` — bind it wider or share a network.

## Conventions & gotchas

- `pnpm typecheck` (tsgo) · `pnpm lint` · `pnpm format:fix` after changes · `pnpm test`.
- Never touch `pnpm-lock.yaml`; installs use `pnpm add --lockfile=false` (CI too, for now).
- Platform access only through `@sealant/sdk`; gaps go to `PLATFORM-FEEDBACK.md` — including
  release-artifact bugs found while dogfooding (two are filed against 0.5.0 there: the api image
  missing the Agent SDK native binary, and the ssh-gateway env break on upgraded installs).
- Design source of truth for any UI work: `DESIGN.md`.

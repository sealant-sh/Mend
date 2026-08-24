---
"@sealant/mend": minor
---

The server is now two processes: the Mend API server (`apps/api` — the typed contract, auth, the
WebSocket data planes, the session engine, and the workers; port 3101, `MEND_MODE=all|api|worker`)
and a stateless web server (`apps/web` — the TanStack app plus a transparent `/api` proxy carrying
HTTP, SSE, and WebSocket upgrades; port 3105). Clients keep one origin and need no changes. The
single-host installer and Docker image supervise both via `scripts/serve.mjs`; on Kubernetes the
chart deploys them as separate tiers, and the web tier can be replicated.

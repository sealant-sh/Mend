# The product is one image plus Postgres (ARCHITECTURE.md §1). The same image
# runs both servers: the Mend API (apps/api — contract, engine, workers;
# MEND_MODE=all|api|worker) and the stateless web server (apps/web — TanStack
# app + /api proxy). The default CMD supervises both for single-host use;
# Kubernetes runs each entry as its own Deployment (deploy/helm/mend).
#
# Node 24 executes the TypeScript sources directly (type stripping); only the
# web app's client/SSR bundle needs a build. The container-local installs run
# with --lockfile=false on purpose: the repo's pnpm-lock.yaml is never written
# by tooling here.

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --lockfile=false
RUN pnpm --filter @mend/web build

# Production node_modules only, resolved against the same manifests.
FROM base AS prod-deps
COPY pnpm-workspace.yaml package.json ./
COPY tooling/typescript/package.json tooling/typescript/
COPY packages/ui/package.json packages/ui/
COPY packages/domain/package.json packages/domain/
COPY packages/db/package.json packages/db/
COPY packages/api/package.json packages/api/
COPY packages/auth/package.json packages/auth/
COPY packages/jobs/package.json packages/jobs/
COPY packages/sealant/package.json packages/sealant/
COPY packages/inference/package.json packages/inference/
COPY packages/sessions/package.json packages/sessions/
COPY packages/store/package.json packages/store/
COPY packages/agent-protocol/package.json packages/agent-protocol/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN pnpm install --prod --lockfile=false --ignore-scripts

FROM base AS runtime
# The store shells out to git (adopt, worktrees, checkpoints, diffs) and spawns ssh for the
# workspace git transport; slim images carry neither.
RUN apt-get update && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production MEND_MODE=all PORT=3105 MEND_API_PORT=3101
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/packages packages
COPY --from=prod-deps /app/apps apps
COPY --from=prod-deps /app/tooling tooling
COPY packages packages
COPY apps/web/src apps/web/src
COPY apps/api/src apps/api/src
COPY scripts/serve.mjs scripts/serve.mjs
COPY --from=build /app/apps/web/dist apps/web/dist
EXPOSE 3105 3101
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT??3105)+'/api/health').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "scripts/serve.mjs"]

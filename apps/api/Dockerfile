# The Mend API server (apps/api): contract + auth + WS data planes + session
# engine + workers (MEND_MODE=all|api|worker). Node runs the TypeScript
# directly (repo convention), which requires the pnpm WORKSPACE layout at
# runtime: node refuses to strip types under node_modules, and the workspace's
# symlinks are what keep package sources outside it. So this image is a
# production-only FILTERED install (the API package and its dependencies —
# no web app, no devDependencies), not a bundle.
#
# Build context is the REPO ROOT:
#   docker build -f apps/api/Dockerfile -t mend-api .

FROM node:26-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Node >=25 no longer bundles corepack; install it — it still honors the
# packageManager pin in package.json.
RUN npm install -g corepack && corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --prod --filter "@mend/api-server..."

FROM node:26-slim
# Sessions and adoption need git; mend-key auth mode speaks ssh.
RUN apt-get update && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production MEND_MODE=all PORT=3101
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/pnpm-workspace.yaml /app/package.json ./
COPY --from=build /app/packages packages
COPY --from=build /app/tooling tooling
COPY --from=build /app/apps/api apps/api
EXPOSE 3101
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT??3101)+'/api/health').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/api/src/main.ts"]

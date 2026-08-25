# The Mend web tier (apps/web): TanStack Start SSR + static assets + the tRPC
# surface + the transparent /api proxy — built to a self-contained dist/ and
# shipped WITHOUT source or node_modules. The SSR bundle is fully bundled
# (vite ssr.noExternal) and the server entry is an esbuild bundle, so the
# runtime layer is node + ~16MB of artifacts.
#
# Build context is the REPO ROOT (the workspace is needed to compile):
#   docker build -f apps/web/Dockerfile -t mend-web .

FROM node:26-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Node >=25 no longer bundles corepack; install it — it still honors the
# packageManager pin in package.json.
RUN npm install -g corepack && corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @mend/web build

FROM node:26-slim
ENV NODE_ENV=production PORT=3105
WORKDIR /app
COPY --from=build /app/apps/web/dist dist
USER node
EXPOSE 3105
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT??3105)+'/api/health').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/entry.mjs"]

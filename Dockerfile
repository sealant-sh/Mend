# Mend bundle: one Mend container plus one official Postgres container at runtime.
# Sealant stays a published platform dependency. These stages copy the released 0.28.0 artifacts;
# this build never imports Core source or its database schema.
FROM ghcr.io/sealant-sh/sealant-api@sha256:8b171e4c7818cb634208d6253799565a69f0fec4be35f4578cc4be6c9b6eba51 AS sealant-api
FROM ghcr.io/sealant-sh/sealant-worker@sha256:e66005128fd32c19e6cea46189ce00e0edeb258221104bf77d6e1aa2e48dfc41 AS sealant-worker
FROM ghcr.io/sealant-sh/sealant-ssh-gateway@sha256:5c408d44c5b6e671a9540557e9d1da826d316b2b15c18547fbb0b47581438638 AS sealant-ssh-gateway
FROM ghcr.io/project-zot/zot-minimal@sha256:346cefc8dd90c6ffe1e714460ba4bb5f867eacae9b40ca87da3c2e7e034ad31a AS zot

FROM node:26-bookworm-slim AS mend-build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN npm install --global corepack && corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @mend/web build

FROM node:26-bookworm-slim AS mend-production-dependencies
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN npm install --global corepack && corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --prod \
  --filter "@mend/api-server..." \
  --filter "@mend/web..."

# RabbitMQ is a supporting process in the Mend image, not an idle Compose service. Its official
# Ubuntu image supplies Erlang, rabbitmq-server, gosu, and the maintained container entrypoint.
FROM rabbitmq:4.2.9-management@sha256:e70db4e9198f2e49c42a9857452436a0eb610da85875fd74a51487b648c64976 AS runtime

ARG MEND_VERSION=dev
LABEL org.opencontainers.image.title="Mend bundle" \
  org.opencontainers.image.version="${MEND_VERSION}" \
  dev.sealant.mend.sealant-version="0.28.0"

# Required by Sealant's root-owned control sockets and the host Docker socket contract.
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git gh libatomic1 openssh-client \
  && rm -rf /var/lib/apt/lists/*

# Node comes from Mend's build image. Sealant's published bundles support this newer runtime too.
COPY --from=mend-build /usr/local/bin/node /usr/local/bin/node
# The released worker carries the Docker 27 CLI and matching buildx plugin it was tested with.
COPY --from=sealant-worker /usr/local/bin/docker /usr/local/bin/docker
COPY --from=sealant-worker /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx

WORKDIR /app
COPY --from=mend-production-dependencies /app/node_modules ./node_modules
COPY --from=mend-production-dependencies /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=mend-production-dependencies /app/packages ./packages
COPY --from=mend-production-dependencies /app/tooling ./tooling
COPY --from=mend-production-dependencies /app/apps/api ./apps/api
COPY --from=mend-production-dependencies /app/apps/web ./apps/web
COPY --from=mend-build /app/apps/web/.output ./apps/web/.output
COPY scripts/process-supervisor.mjs scripts/process-supervisor.mjs
COPY scripts/bundle-supervisor.mjs scripts/bundle-supervisor.mjs
COPY scripts/bundle-health.mjs scripts/bundle-health.mjs

COPY --from=sealant-api /app/dist /opt/sealant/api/dist
COPY --from=sealant-api /app/drizzle /opt/sealant/api/drizzle
COPY --from=sealant-api /app/node_modules /opt/sealant/api/node_modules
COPY --from=sealant-worker /app/dist /opt/sealant/worker/dist
COPY --from=sealant-worker /app/node_modules /opt/sealant/worker/node_modules
COPY --from=sealant-ssh-gateway /app/dist /opt/sealant/ssh-gateway/dist
COPY --from=sealant-ssh-gateway /app/node_modules /opt/sealant/ssh-gateway/node_modules
COPY --from=zot /usr/local/bin/ /opt/zot/
COPY deploy/docker/zot-config.json /etc/zot/config.json
RUN zot_binary="$(find /opt/zot -maxdepth 1 -type f -name 'zot-linux-*-minimal' -print -quit)" \
  && test -n "$zot_binary" \
  && ln -s "$zot_binary" /usr/local/bin/zot \
  && mkdir -p /var/lib/mend/store /var/lib/mend/config /var/lib/mend/ssh /var/lib/registry /run/sealant/sockets /run/mend-bundle

ENV NODE_ENV=production \
  MEND_VERSION=${MEND_VERSION} \
  HOME=/var/lib/mend/config \
  XDG_CONFIG_HOME=/var/lib/mend/config \
  MEND_MODE=all \
  MEND_STORE_ROOT=/var/lib/mend/store \
  SEALANT_MOUNT_ALLOWED_STORE_ROOTS=/var/lib/mend/store \
  SEALANT_DOCKER_VOLUME_MAPPINGS='[{"logicalRoot":"/var/lib/mend/store","volumeName":"mend-store"},{"logicalRoot":"/run/sealant/sockets","volumeName":"mend-control"}]'

EXPOSE 3105 2222 5000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=8s --start-period=90s --retries=4 \
  CMD ["node", "/app/scripts/bundle-health.mjs"]
ENTRYPOINT ["node", "/app/scripts/bundle-supervisor.mjs"]

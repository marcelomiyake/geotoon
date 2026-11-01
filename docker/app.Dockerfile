# syntax=docker/dockerfile:1
# GeoToon app image: API, built web client, migrations and the DuckDB httpfs extension.
# node:26-bookworm-slim, pinned by digest (update the tag in this comment with the digest).
ARG NODE_IMAGE=node@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9

FROM ${NODE_IMAGE} AS build
WORKDIR /src
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
COPY package.json package-lock.json tsconfig.base.json tsconfig.build.json ./
COPY packages/core/package.json packages/core/
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# Only dev-only test tooling has install scripts; the shipped dependencies need none.
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY packages packages
COPY apps apps
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM ${NODE_IMAGE} AS duckdb-ext
WORKDIR /ext
COPY --from=build /src/node_modules ./node_modules
COPY docker/install-duckdb-extensions.mjs ./
RUN node install-duckdb-extensions.mjs /opt/duckdb/extensions

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    STATIC_DIR=/app/public \
    DUCKDB_EXTENSION_DIR=/opt/duckdb/extensions \
    DUCKDB_TEMP_DIR=/tmp/duckdb
WORKDIR /app
# DuckDB's httpfs uses its own TLS stack and needs the system CA bundle to reach S3.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 geotoon \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin geotoon
COPY --from=build /src/package.json ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/packages/core/package.json packages/core/
COPY --from=build /src/packages/core/dist packages/core/dist
COPY --from=build /src/packages/contracts/package.json packages/contracts/
COPY --from=build /src/packages/contracts/dist packages/contracts/dist
COPY --from=build /src/apps/api/package.json apps/api/
COPY --from=build /src/apps/api/dist apps/api/dist
COPY --from=build /src/apps/api/migrations apps/api/migrations
COPY --from=build /src/apps/web/dist public
COPY --from=duckdb-ext /opt/duckdb/extensions /opt/duckdb/extensions
USER 10001:10001
EXPOSE 8080
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}
CMD ["node", "apps/api/dist/main.js"]

# mimo2codex-docweb image
# ─────────────────────────────────────────────────────────────────────────────
# Build context MUST be the repo root (docweb pulls ../doc/*.md and
# ../images/*.png at build time via Vite import.meta.glob / ?url).
#
# Build (single-arch, load locally):
#   docker buildx build --file docweb/Dockerfile -t mimo2codex-docweb --load .
#
# Build & push multi-arch via scripts/docker-build-push.ps1.
# ─────────────────────────────────────────────────────────────────────────────

# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

# npm registry override. Default to npmmirror.com — registry.npmjs.org
# times out from CN-based build machines (EIDLETIMEOUT after ~5 minutes),
# which kills `docker buildx build` reliably. npmmirror is a transparent
# full mirror of the npm registry, so resolved package content is
# byte-identical to the official source.
#
# Override at build time if you're not in CN and want the official source:
#   docker buildx build --build-arg NPM_REGISTRY=https://registry.npmjs.org ...
ARG NPM_REGISTRY=https://registry.npmmirror.com

WORKDIR /app

# Copy the manifest first to leverage Docker layer cache on deps.
COPY docweb/package.json ./docweb/
COPY docweb/package-lock.json* ./docweb/

WORKDIR /app/docweb
# Bump fetch timeouts a bit so the build doesn't die over a single slow
# package even when the registry IS reachable.
RUN npm config set registry "$NPM_REGISTRY" \
  && npm config set fetch-timeout 600000 \
  && npm config set fetch-retries 5 \
  && npm install --no-audit --no-fund

# Bring in the docs and image assets the site renders.
WORKDIR /app
COPY doc ./doc
COPY images ./images

# Bring in the docweb sources (selective, to keep the build context small).
COPY docweb/src ./docweb/src
COPY docweb/public ./docweb/public
COPY docweb/index.html ./docweb/
COPY docweb/vite.config.ts ./docweb/
COPY docweb/tsconfig.json ./docweb/

WORKDIR /app/docweb
RUN npm run build

# ── Runtime stage: nginx static server ───────────────────────────────────────
FROM nginx:alpine AS runtime

COPY --from=builder /app/docweb/dist /usr/share/nginx/html
COPY docweb/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# nginx:alpine's default entrypoint already runs nginx in the foreground.

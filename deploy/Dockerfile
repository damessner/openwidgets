# syntax=docker/dockerfile:1
# OpenWidgets — single Node.js process, zero runtime npm dependencies.
#
# Build context is the REPOSITORY ROOT (not deploy/):
#   docker build -f deploy/Dockerfile -t openwidgets:latest .
#   # or: docker compose -f deploy/docker-compose.yml up -d --build
#
# Deliberately NO `npm install` / `npm ci`: the app has zero runtime
# dependencies (docs/CONTRACT.md §0). Only optional dev deps live under
# tools/e2e/ and are neither needed nor copied into the image.

FROM node:24-bookworm-slim

# ffmpeg is optional at runtime: uploaded audio (WAV/OGG/M4A/WebM) is
# transcoded to MP3 when the binary is present, otherwise stored as-is.
RUN apt-get update -y && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Contract defaults for a container. HOST=0.0.0.0 is correct *inside* the
# container because docker-compose publishes the port on 127.0.0.1 only.
# The native systemd deployment uses HOST=127.0.0.1 instead.
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

WORKDIR /app

# Copy the repo (deploy/Dockerfile.dockerignore excludes .git, docs, test,
# tools, data, node_modules and markdown).
# Using a single COPY keeps the image buildable even if an optional directory
# is absent; the runtime only needs server/, shared/, public/ and scripts/.
# NO `npm install` / `npm ci` on purpose — see docs/CONTRACT.md §0.
COPY . .

# Data volume; the image ships a non-root "node" user (uid 1000).
RUN install -d -o node -g node -m 0750 /data

USER node

VOLUME ["/data"]
EXPOSE 3000

# GET /api/health -> 200 {"status":"ok",...,"db":"ok"}; 503 when the DB probe fails.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]

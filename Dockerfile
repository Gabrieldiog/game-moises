# syntax=docker/dockerfile:1
# Moisés: one image, one port. The Node server also serves the web client.

# ---- build: all dependencies, builds shared + server (dist/main.js) + client (dist/)
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --ignore-scripts
COPY shared shared
COPY server server
COPY client client
# Public address of the game (the client is built for it). Not a secret: it ends up in the JS bundle.
# Required: without it the client starts in demo mode with no server.
ARG VITE_SERVER_URL
ENV VITE_SERVER_URL=${VITE_SERVER_URL}
RUN npm run build

# ---- prod-deps: only what the server needs at runtime (socket.io, zod)
FROM node:22-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --ignore-scripts --workspace=server --include-workspace-root=false \
 && npm cache clean --force

# ---- runtime
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    STATIC_DIR=/app/client/dist
WORKDIR /app
COPY --from=prod-deps --chown=root:root /app/node_modules node_modules
COPY --from=build --chown=root:root /app/server/dist server/dist
COPY --from=build --chown=root:root /app/client/dist client/dist
COPY --chown=root:root server/package.json server/package.json
# Runs as the unprivileged "node" user (uid 1000) shipped with the image; files stay root-owned (read-only for it).
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "server/dist/main.js"]

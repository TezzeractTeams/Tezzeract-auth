# tezzeract-auth — multi-stage build.
#
# The final image serves the API, the OIDC endpoints and web/dist from one
# origin, which is what makes the session cookie first-party.

# ----------------------------------------------------------------- build ----
FROM node:22.12-alpine AS build

# Pinned so a build cannot silently pick up a different package manager.
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /repo

# Manifests first, so a dependency install is cached independently of source.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY ui/package.json ./ui/
COPY web/package.json ./web/
COPY server/package.json ./server/

# --frozen-lockfile makes the build fail rather than resolve something the
# lockfile did not record.
RUN pnpm install --frozen-lockfile

COPY . .

# web/dist is served by the server; the server compiles to server/dist.
# VITE_USE_MOCKS is deliberately unset, so the mock API is eliminated from the
# bundle rather than merely unreachable.
RUN pnpm --filter @tezzeract/auth-web build \
 && pnpm --filter @tezzeract/auth-server build

# Drop dev dependencies from the tree that gets copied forward.
RUN pnpm --filter @tezzeract/auth-server --prod deploy /pruned

# --------------------------------------------------------------- runtime ----
FROM node:22.12-alpine AS runtime

# dumb-init reaps zombies and forwards SIGTERM, so the server's graceful
# shutdown actually runs instead of the container being killed.
RUN apk add --no-cache dumb-init

ENV NODE_ENV=production
# Keeps the heap inside a typical 512Mi container limit.
ENV NODE_OPTIONS=--max-old-space-size=384

WORKDIR /app

# Runs as the node user (uid 1000) that the base image already provides,
# never as root.
COPY --chown=node:node --from=build /pruned/node_modules ./node_modules
COPY --chown=node:node --from=build /repo/server/dist ./dist
COPY --chown=node:node --from=build /repo/server/src/db/migrations ./dist/db/migrations
COPY --chown=node:node --from=build /repo/web/dist ../web/dist

USER node

EXPOSE 3000

# Reports unhealthy when the database is unreachable, which /healthz answers
# with a 503.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]

# One image, one process: the site and the remote connector share a graph
# handle, so they cannot be split into separate containers.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# The graph engine ships a platform-specific native binary, so this must be a
# real install on the target platform rather than a copied node_modules.
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
# The graph engine's native binary links against libssl, which the slim image
# does not ship. Next loads that module while collecting page data, so the
# build fails without it — not just the runtime. Installing `openssl` rather
# than a versioned `libssl3` keeps this working across Debian releases, where
# the library package gets renamed.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Same shared libraries the engine needs at run time; ca-certificates so the
# bring-your-own-key path can reach the API over TLS.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY package.json next.config.ts tsconfig.json server.ts ./
COPY src ./src
COPY app ./app
COPY ontology ./ontology
# Ships the operational commands with the image: `docker exec <container> npm run
# backup` is what you want available on a running deployment, not something to
# reconstruct under pressure.
COPY scripts ./scripts

# Where the graph lives. Mount a volume here — the database is a real file and
# does not survive a container restart otherwise.
ENV GRAPH_PATH=/data/graph
VOLUME /data

EXPOSE 3000
CMD ["npm", "start"]

FROM node:24-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Bake the seeded landmark set in at a path the mounted volume cannot shadow.
# See docker-entrypoint.sh: first boot copies it onto an empty volume, so a
# deploy never waits on — or fails because of — the Overpass API.
RUN mkdir -p /app/seed && \
    if [ -f data/seen.db ]; then cp data/seen.db /app/seed/seen.db; fi

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

# data/ holds the archive (sqlite + photos + 3D models) — mount a volume so it
# survives redeploys.
VOLUME ["/app/data"]

CMD ["sh", "/app/docker-entrypoint.sh"]

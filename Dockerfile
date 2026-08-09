FROM node:24-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# seed/landmarks.db is committed (unlike data/, which is gitignored), so this
# works when the platform builds from a clean clone. See docker-entrypoint.sh:
# first boot copies it onto an empty disk, and the deploy never waits on — or
# fails because of — the Overpass API. Regenerate with `npm run snapshot`.
RUN test -f seed/landmarks.db || \
    (echo "FATAL: seed/landmarks.db missing — run 'npm run snapshot' and commit it" && exit 1)

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

# data/ holds the archive (sqlite + photos + 3D models) — mount a volume so it
# survives redeploys.
VOLUME ["/app/data"]

CMD ["sh", "/app/docker-entrypoint.sh"]

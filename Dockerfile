FROM node:24-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

# data/ holds the archive (sqlite + photos) — mount a volume so it survives redeploys
VOLUME ["/app/data"]

# Seed runs only when the volume is empty (seed.ts early-exits otherwise), then
# the server starts.
#
# `;` rather than `&&`, deliberately: seed.ts exits 1 when every Overpass mirror
# refuses, and Overpass rate-limits hard. Under `&&` that exit code stops the
# server from ever starting — so a cold start during judging (guaranteed on
# Render's free tier, which sleeps after ~15 min idle) could crash-loop the
# service on somebody else's rate limit. An empty map is recoverable. A dead
# link while a judge is looking at it is not.
CMD ["sh", "-c", "npm run seed || echo '[seen] seed skipped or failed — starting server anyway'; npm start"]

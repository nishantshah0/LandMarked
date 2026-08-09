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

# Seed runs only when the volume is empty, then the server starts.
CMD ["sh", "-c", "npm run seed && npm start"]

# The always-on metering worker (src/worker/index.ts). The web app on Vercel is
# request-scoped and can't run a loop; this container streams the actual charges.
FROM oven/bun:1-slim

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .

ENV NODE_ENV=production
# Render injects PORT; the worker's health server binds to it.
CMD ["bun", "run", "src/worker/index.ts"]

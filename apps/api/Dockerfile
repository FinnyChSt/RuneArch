# Build context: repository root (see docker-compose.yml)
FROM node:24-alpine
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# Install dependencies before copying app source so this layer is cached across API changes.
# The root postinstall builds packages/shared, so its source is copied up front.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared packages/shared
RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
RUN pnpm --filter api build

WORKDIR /app/apps/api
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
# Dev deps are kept on purpose: drizzle-kit and tsx run migrations and the dev-user seed on start
CMD ["sh", "-c", "node_modules/.bin/drizzle-kit migrate && node_modules/.bin/tsx src/db/seed.ts && node dist/main.js"]

# Build context: repository root (see docker-compose.yml)
FROM node:24-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# Install dependencies before copying app source so this layer is cached across web changes.
# The root postinstall builds packages/shared, so its source is copied up front.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared packages/shared
RUN pnpm install --frozen-lockfile

COPY apps/web apps/web
RUN pnpm --filter web build

FROM nginx:1.29-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80

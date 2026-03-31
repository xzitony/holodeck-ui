# Stage 1: Install dependencies
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# Stage 2: Build the application
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public
ENV DATABASE_URL="file:./prisma/dev.db"

# Build-time metadata
ARG GIT_SHA=""
ARG BUILD_TIME=""
ENV NEXT_PUBLIC_GIT_SHA=${GIT_SHA}
ENV NEXT_PUBLIC_BUILD_TIME=${BUILD_TIME}

RUN npx prisma generate
# Compile seed.ts → seed.js so the production container can run it without tsx
RUN npx tsc --esModuleInterop --module commonjs --target es2020 --outDir prisma/compiled prisma/seed.ts --resolveJsonModule --skipLibCheck --ignoreConfig --types node \
    && mv prisma/compiled/prisma/seed.js prisma/seed.js && rm -rf prisma/compiled
RUN npm run build

# Stage 3: Production runner
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN apk add --no-cache tmux openssh-client sshpass

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 --shell /bin/sh nextjs

# Copy standalone server output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy full node_modules from builder (needed for Prisma CLI migrations)
# The standalone server.js has its deps bundled, so this doesn't conflict
COPY --from=builder /app/node_modules ./node_modules

# Copy prisma schema + migrations + seed
COPY --from=builder /app/prisma ./prisma

# Copy config for seed script
COPY --from=builder /app/config ./config

# Create data directory for SQLite DB volume mount
RUN mkdir -p /app/data

# Copy entrypoint
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["./docker-entrypoint.sh"]

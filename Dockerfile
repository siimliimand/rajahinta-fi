# =============================================================================
# Rajahinta.fi — production multi-stage Dockerfile
# =============================================================================
# Builds the NestJS backend + all workspace packages into a single production
# image. The frontend (Next.js) is deployed separately as a static site /
# serverless function.
# =============================================================================

# ----------------------------------------------------------------------------
# Stage 1: dependencies
# ----------------------------------------------------------------------------
FROM node:22-alpine AS deps

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/backend/package.json apps/backend/
COPY packages/core-domain/package.json packages/core-domain/
COPY packages/application-api/package.json packages/application-api/
COPY packages/data-acquisition/package.json packages/data-acquisition/
COPY packages/data-platform/package.json packages/data-platform/

RUN pnpm install --frozen-lockfile --prod

# ----------------------------------------------------------------------------
# Stage 2: builder — install dev dependencies + compile
# ----------------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/backend apps/backend
COPY packages packages

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @rajahinta/backend run build

# ----------------------------------------------------------------------------
# Stage 3: production runtime
# ----------------------------------------------------------------------------
FROM node:22-alpine AS runner

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 rajahinta

WORKDIR /app

# Copy production node_modules from deps stage
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/apps/backend/node_modules apps/backend/node_modules
COPY --from=deps /app/packages packages

# Copy built artifacts from builder
COPY --from=builder /app/apps/backend/dist apps/backend/dist
COPY --from=builder /app/packages/core-domain/dist packages/core-domain/dist
COPY --from=builder /app/packages/application-api/dist packages/application-api/dist
COPY --from=builder /app/packages/data-acquisition/dist packages/data-acquisition/dist
COPY --from=builder /app/packages/data-platform/dist packages/data-platform/dist

# Copy package.json for the start command
COPY --from=builder /app/apps/backend/package.json apps/backend/
COPY --from=builder /app/package.json ./

USER rajahinta

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "apps/backend/dist/main"]
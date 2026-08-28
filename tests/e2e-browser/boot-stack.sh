#!/usr/bin/env bash
# =============================================================================
# boot-stack.sh — one command to the browser-E2E stack (task 12.2)
#
# Boots the REAL composed stack the Playwright suite runs against:
#   - PostgreSQL 16 + TimescaleDB and Redis 7 (docker compose, repo compose
#     file — same images as docker-compose.yml / CI)
#   - Drizzle migrations + the staging seed (TEST Beer / TEST Wine, fake
#     tax rules, transport + retail offers)
#   - the NestJS backend on :3000 (launch gates open, feature flags OFF —
#     the same defaults a clean CI runner gets)
#   - the Next.js dev server on :3001
#
# The frontend's NEXT_PUBLIC_API_URL points straight at the backend
# (:3000): the browser performs the genuine cross-origin CORS + cookie
# dance against the real NestJS CORS configuration
# (enableCors with credentials:true — fixed after the e2e wave).
#
# Usage:
#   bash tests/e2e-browser/boot-stack.sh           # start everything
#   SKIP_BUILD=1 bash tests/e2e-browser/boot-stack.sh   # packages prebuilt
#   bash tests/e2e-browser/boot-stack.sh --down    # stop everything
#
# Requirements: docker, pnpm install already run at the repo root.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="${RAJAHINTA_LOG_DIR:-/tmp/rajahinta-e2e-browser}"
DB_URL="postgresql://rajahinta:rajahinta@localhost:5432/rajahinta"

BACKEND_PORT="${BACKEND_PORT:-3000}"
FRONTEND_PORT="${FRONTEND_PORT:-3001}"
# Where the browser sends API calls: the backend directly. The cross-origin
# topology (frontend :3001 → API :3000) exercises the real CORS +
# httpOnly-cookie flow end to end.
API_URL="http://localhost:${BACKEND_PORT}"

mkdir -p "$LOG_DIR"

stop_stack() {
  echo "Stopping browser-E2E stack…"
  for pidfile in "$LOG_DIR"/backend.pid "$LOG_DIR"/frontend.pid; do
    if [ -f "$pidfile" ]; then
      kill -- -"$(cat "$pidfile")" 2>/dev/null || kill "$(cat "$pidfile")" 2>/dev/null || true
      rm -f "$pidfile"
    fi
  done
  (cd "$ROOT" && docker compose down) || true
  echo "Stopped. (DB volume kept — docker compose down --volumes to wipe.)"
}

if [ "${1:-}" = "--down" ]; then
  stop_stack
  exit 0
fi

# --- 1. Infrastructure (PostgreSQL 16 + TimescaleDB, Redis 7) ----------------
echo "==> Starting PostgreSQL + Redis…"
(cd "$ROOT" && docker compose up -d postgres redis)

echo -n "==> Waiting for Postgres health"
for _ in $(seq 1 30); do
  healthy=$(docker inspect --format '{{.State.Health.Status}}' \
    rajahinta-postgres 2>/dev/null || echo "starting")
  [ "$healthy" = "healthy" ] && break
  echo -n "."
  sleep 1
done
echo " ($healthy)"
[ "$healthy" = "healthy" ] || { echo "FATAL: Postgres never became healthy" >&2; exit 1; }

# --- 2. Schema (Drizzle migrations — the single source of truth) ------------
echo "==> Applying Drizzle migrations…"
(cd "$ROOT" && DATABASE_URL="$DB_URL" \
  pnpm --filter @rajahinta/data-platform exec drizzle-kit migrate)

# --- 3. Seed data (idempotent: products, tax rules, transport + offers) ------
# The staging seed itself stamps gate-valid canonical classifications
# ('beer' / 'wine_still') and self-heals rows seeded from older volumes.
echo "==> Seeding database (idempotent)…"
(cd "$ROOT" && DATABASE_URL="$DB_URL" \
  pnpm --filter @rajahinta/data-platform exec tsx \
    --tsconfig "$ROOT/packages/data-platform/tsconfig.json" \
    "$ROOT/packages/data-platform/src/seed/seed-runner.ts")

# --- 4. Build workspace packages the backend consumes (dist/ outputs) -------
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "==> Building backend + workspace dependencies…"
  (cd "$ROOT" && pnpm --filter @rajahinta/backend... run build)
else
  echo "==> SKIP_BUILD=1 — using existing dist/ artifacts"
fi

# --- 5. Backend (NestJS dev; gates open so the calculator is usable) --------
# No FF_* variables are set: feature flags default OFF, the same state a
# clean CI runner produces, so local and CI runs test the same surfaces.
echo "==> Starting backend on :$BACKEND_PORT…"
(
  cd "$ROOT"
  setsid env DATABASE_URL="$DB_URL" LAUNCH_GATES_OVERRIDE=true PORT="$BACKEND_PORT" \
    pnpm --filter @rajahinta/backend dev >"$LOG_DIR/backend.log" 2>&1 &
  echo $! > "$LOG_DIR/backend.pid"
)

# --- 6. Frontend (Next.js dev server; API base = backend directly) ----------
echo "==> Starting frontend on :$FRONTEND_PORT (API: $API_URL)…"
(
  cd "$ROOT/apps/frontend"
  setsid env NEXT_PUBLIC_API_URL="$API_URL" \
    pnpm exec next dev -p "$FRONTEND_PORT" >"$LOG_DIR/frontend.log" 2>&1 &
  echo $! > "$LOG_DIR/frontend.pid"
)

# --- 7. Readiness -------------------------------------------------------------
wait_http() {
  local url="$1" name="$2" tries="${3:-90}"
  echo -n "==> Waiting for $name"
  for _ in $(seq 1 "$tries"); do
    if curl -s -o /dev/null --max-time 2 "$url"; then echo " up"; return 0; fi
    echo -n "."
    sleep 1
  done
  echo " TIMEOUT — check $LOG_DIR" >&2
  return 1
}

wait_http "http://localhost:$BACKEND_PORT/api/v1/health" "backend"
wait_http "http://localhost:$FRONTEND_PORT" "frontend"

cat <<EOF

✅ Browser-E2E stack is up

   Frontend   http://localhost:$FRONTEND_PORT
   Backend    http://localhost:$BACKEND_PORT   (Swagger: /api/docs)
   API path   $API_URL
   Postgres   localhost:5432 (rajahinta/rajahinta)

   ⚠  Launch gates are DISABLED (LAUNCH_GATES_OVERRIDE=true).

   Logs       $LOG_DIR/{backend,frontend}.log
   Stop       bash tests/e2e-browser/boot-stack.sh --down
EOF

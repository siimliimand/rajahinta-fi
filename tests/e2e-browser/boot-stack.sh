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
#   - the CORS shim on :3002 (see cors-shim.mjs — reported backend defect:
#     enableCors lacks credentials:true, which breaks every credentialed
#     cross-origin API call from the browser)
#
# The frontend's NEXT_PUBLIC_API_URL points at the SHIM (:3002), so the
# browser performs the genuine cross-origin CORS + cookie dance through
# the shim to the backend.
#
# Usage:
#   bash tests/e2e-browser/boot-stack.sh           # start everything
#   SKIP_BUILD=1 bash tests/e2e-browser/boot-stack.sh   # packages prebuilt
#   E2E_DIRECT=1 ...   # no shim; API URL = backend directly (post-fix)
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
SHIM_PORT="${SHIM_PORT:-3002}"
# Where the browser sends API calls: the shim by default, the backend
# directly when E2E_DIRECT=1 (valid once the CORS defect is fixed).
API_URL="http://localhost:${SHIM_PORT}"
SHIM_ENABLED=1
if [ "${E2E_DIRECT:-0}" = "1" ]; then
  API_URL="http://localhost:${BACKEND_PORT}"
  SHIM_ENABLED=0
fi

mkdir -p "$LOG_DIR"

stop_stack() {
  echo "Stopping browser-E2E stack…"
  for pidfile in "$LOG_DIR"/backend.pid "$LOG_DIR"/frontend.pid "$LOG_DIR"/shim.pid; do
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
echo "==> Seeding database (idempotent)…"
(cd "$ROOT" && DATABASE_URL="$DB_URL" \
  pnpm --filter @rajahinta/data-platform exec tsx \
    --tsconfig "$ROOT/packages/data-platform/tsconfig.json" \
    "$ROOT/packages/data-platform/src/seed/seed-runner.ts")

# --- 3b. Minimum fixture correction (REPORTED DEFECT) ------------------------
# The staging seed stamps regulatoryClassification 'BEER_STANDARD' /
# 'WINE_STILL', which the task-7.1 classification gate rejects
# (KNOWN_REGULATORY_CLASSIFICATIONS uses the canonical lowercase
# vocabulary: 'beer', 'wine_still', …). Until the seed is fixed, every
# seeded product fails the calculator with 422. This harness-owned,
# idempotent UPDATE aligns the two seeded TEST products with the gate's
# vocabulary — no app or package code is modified.
echo "==> Applying minimum fixture: gate-valid classifications for seeded TEST products…"
docker exec rajahinta-postgres psql -U rajahinta -d rajahinta -v ON_ERROR_STOP=1 <<'SQL'
UPDATE product_master SET regulatory_classification = 'beer'
  WHERE ean = '000000000001' AND regulatory_classification = 'BEER_STANDARD';
UPDATE product_master SET regulatory_classification = 'wine_still'
  WHERE ean = '000000000002' AND regulatory_classification = 'WINE_STILL';
SQL

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

# --- 6. CORS shim (see cors-shim.mjs) ----------------------------------------
if [ "$SHIM_ENABLED" = "1" ]; then
  echo "==> Starting CORS shim on :$SHIM_PORT → :$BACKEND_PORT…"
  (
    cd "$ROOT"
    setsid env PORT="$SHIM_PORT" TARGET="http://localhost:$BACKEND_PORT" \
      node tests/e2e-browser/cors-shim.mjs >"$LOG_DIR/shim.log" 2>&1 &
    echo $! > "$LOG_DIR/shim.pid"
  )
fi

# --- 7. Frontend (Next.js dev server; API base through the shim) ------------
echo "==> Starting frontend on :$FRONTEND_PORT (API: $API_URL)…"
(
  cd "$ROOT/apps/frontend"
  setsid env NEXT_PUBLIC_API_URL="$API_URL" \
    pnpm exec next dev -p "$FRONTEND_PORT" >"$LOG_DIR/frontend.log" 2>&1 &
  echo $! > "$LOG_DIR/frontend.pid"
)

# --- 8. Readiness -------------------------------------------------------------
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
if [ "$SHIM_ENABLED" = "1" ]; then
  wait_http "http://localhost:$SHIM_PORT/api/v1/health" "CORS shim → backend"
fi

cat <<EOF

✅ Browser-E2E stack is up

   Frontend   http://localhost:$FRONTEND_PORT
   Backend    http://localhost:$BACKEND_PORT   (Swagger: /api/docs)
   API path   $API_URL$( [ "$SHIM_ENABLED" = "1" ] && echo "   (CORS shim — see cors-shim.mjs)" )
   Postgres   localhost:5432 (rajahinta/rajahinta)

   ⚠  Launch gates are DISABLED (LAUNCH_GATES_OVERRIDE=true).

   Logs       $LOG_DIR/{backend,frontend,shim}.log
   Stop       bash tests/e2e-browser/boot-stack.sh --down
EOF

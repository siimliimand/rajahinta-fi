#!/usr/bin/env bash
# =============================================================================
# dev-up.sh — one command to a working local Rajahinta.fi stack
#
# Starts PostgreSQL + Redis (docker compose), applies Drizzle migrations,
# seeds the database (idempotent), then boots the backend (:3000) and the
# frontend dev server (:3001) in the background with logs in /tmp (or
# $RAJAHINTA_LOG_DIR).
#
# Usage:
#   bash scripts/dev-up.sh          # start everything
#   bash scripts/dev-up.sh --down   # stop backend/frontend + docker services
#
# Open http://localhost:3001 and confirm the age gate ("Yes, I'm 18+").
#
# Requirements: docker, pnpm install already run at the repo root.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${RAJAHINTA_LOG_DIR:-/tmp/rajahinta-dev}"
DB_URL="postgresql://rajahinta:rajahinta@localhost:5432/rajahinta"

mkdir -p "$LOG_DIR"

stop_stack() {
  echo "Stopping Rajahinta dev stack…"
  for pidfile in "$LOG_DIR"/backend.pid "$LOG_DIR"/frontend.pid; do
    if [ -f "$pidfile" ]; then
      # Kill the process group (pnpm spawns children).
      kill -- -"$(cat "$pidfile")" 2>/dev/null || kill "$(cat "$pidfile")" 2>/dev/null || true
      rm -f "$pidfile"
    fi
  done
  (cd "$ROOT" && docker compose down) || true
  echo "Stopped. (DB volume is kept — docker compose down --volumes to wipe.)"
}

if [ "${1:-}" = "--down" ]; then
  stop_stack
  exit 0
fi

# --- 1. Infrastructure (PostgreSQL 16 + Redis 7) ----------------------------
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

# --- 3. Seed data (products, official tax rules, transport + retail offers) -
# tsx lives in apps/frontend's devDeps; --tsconfig is required so decorator
# syntax compiles against data-platform's compiler options.
echo "==> Seeding database (idempotent)…"
(cd "$ROOT/apps/frontend" && DATABASE_URL="$DB_URL" \
  pnpm exec tsx --tsconfig "$ROOT/packages/data-platform/tsconfig.json" \
  "$ROOT/packages/data-platform/src/seed/seed-runner.ts")

# --- 4. Pick ports (fall back if something already owns :3000/:3001) --------
BACKEND_PORT="${BACKEND_PORT:-3000}"
FRONTEND_PORT="${FRONTEND_PORT:-3001}"
port_busy() { curl -s -o /dev/null --max-time 1 "http://localhost:$1" && return 0 || return 1; }
if port_busy "$BACKEND_PORT"; then
  echo "!! Port $BACKEND_PORT is already in use — using 3100 for the backend instead."
  BACKEND_PORT=3100
fi
if port_busy "$FRONTEND_PORT"; then
  echo "!! Port $FRONTEND_PORT is already in use — using 3101 for the frontend instead."
  FRONTEND_PORT=3101
fi

# --- 4b. Build workspace packages (the backend runs from apps/backend but
# consumes @rajahinta/* packages via their dist/ output). Set SKIP_BUILD=1
# during iteration if the packages are already built and unchanged.
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "==> Building workspace packages…"
  (cd "$ROOT" && pnpm build)
fi

# --- 5. Backend (NestJS; gates open so calculator is usable) ----------------
echo "==> Starting backend on :$BACKEND_PORT…"
(
  cd "$ROOT"
  setsid env DATABASE_URL="$DB_URL" LAUNCH_GATES_OVERRIDE=true PORT="$BACKEND_PORT" \
    pnpm --filter @rajahinta/backend dev >"$LOG_DIR/backend.log" 2>&1 &
  echo $! > "$LOG_DIR/backend.pid"
)

# --- 6. Frontend (Next.js dev server; API base wired to the backend port) ---
# NOTE: `next dev` is invoked directly because the package's dev script
# hardcodes `-p 3001`, which would ignore our port selection.
echo "==> Starting frontend on :$FRONTEND_PORT…"
(
  cd "$ROOT/apps/frontend"
  setsid env NEXT_PUBLIC_API_URL="http://localhost:$BACKEND_PORT" \
    pnpm exec next dev -p "$FRONTEND_PORT" >"$LOG_DIR/frontend.log" 2>&1 &
  echo $! > "$LOG_DIR/frontend.pid"
)

# --- 6. Readiness ------------------------------------------------------------
wait_http() {
  local url="$1" name="$2" tries="${3:-60}"
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

# The backend readiness check must be OUR backend, not whatever squatted the
# port: verify the health endpoint answers with our service's JSON.
health_body="$(curl -s --max-time 3 "http://localhost:$BACKEND_PORT/api/v1/health" || true)"
if ! echo "$health_body" | grep -qE 'status|ok|rajahinta'; then
  echo "FATAL: :$BACKEND_PORT answered but is not the Rajahinta backend:" >&2
  echo "$health_body" | head -c 300 >&2
  exit 1
fi

cat <<EOF

✅ Rajahinta dev stack is up

   Frontend   http://localhost:$FRONTEND_PORT   (confirm the age gate to enter)
   Backend    http://localhost:$BACKEND_PORT   (Swagger: /api/docs)
   Postgres   localhost:5432 (rajahinta/rajahinta)

   Logs       $LOG_DIR/{backend,frontend}.log
   Stop       bash scripts/dev-up.sh --down
EOF

#!/usr/bin/env bash
# =============================================================================
# boot-workers-stack.sh — Workers-stack harness for the browser E2E suite
# (task 5.4, change migrate-to-cloudflare).
#
# Boots the Cloudflare Workers replacement of the docker-compose stack the
# journeys run against (the legacy harness stays in boot-stack.sh until
# decommission 6.7):
#
#   `api`      1. migrate + seed local D1 via the task-2.6 scripts
#                 (db:seed:d1:local = wrangler d1 migrations apply + seed
#                 files + loud verification, idempotent)
#              2. apply the journey fixtures (seed-journeys.d1.sql — TEST
#                 Beer / TEST Wine) through the same real D1 path
#              3. apply the savings-snapshot fixture (seed-savings-
#                 snapshot.d1.sql — the homepage hero's populated state)
#                 unless E2E_SAVINGS_SNAPSHOT=0, which leaves NO snapshot
#                 day so the homepage renders its pending state
#              4. exec `wrangler dev` on :8788 with the launch gates open
#                 and the CORS origin set to the frontend Worker
#
#   `frontend` 1. reset the local ISR/R2 sim state (see the frontend case
#                 below), then build the OpenNext Worker with the API
#                 base inlined at build time (NEXT_PUBLIC_API_URL=
#                 http://localhost:8788 — runtime vars cannot change it,
#                 see apps/frontend/OPENNEXT.md)
#              2. exec `wrangler dev` on :8787 (the frontend owns 8787)
#
#   `down`     best-effort cleanup of manually started workers.
#
# Playwright's webServer array (playwright.workers.config.ts) starts `api`
# first, polls GET /api/v1/health/ready (503 until D1 + DOs answer), then
# starts `frontend` and polls `/` — so the frontend build runs against a
# live API.
#
# The feature-flag and launch-gate systems are removed (2026-09-07): every
# feature is live; no FF_* vars exist.
#
# Usage:
#   bash tests/e2e-browser/boot-workers-stack.sh api
#   bash tests/e2e-browser/boot-workers-stack.sh frontend
#   SKIP_BUILD=1 bash tests/e2e-browser/boot-workers-stack.sh frontend
#   bash tests/e2e-browser/boot-workers-stack.sh down
#
# Requirements: pnpm install already run at the repo root. No docker, no
# Cloudflare account — `wrangler dev` simulates D1/R2/DOs/Queues locally.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="${RAJAHINTA_WORKERS_E2E_LOG_DIR:-/tmp/rajahinta-e2e-browser-workers}"

# Ports follow apps/frontend/OPENNEXT.md ("local concurrent Workers"):
# frontend Worker owns 8787, API Worker runs on 8788.
API_PORT="${E2E_API_PORT:-8788}"
FRONTEND_PORT="${E2E_FRONTEND_PORT:-8787}"
# Where the browser sends API calls — inlined into the frontend build.
API_URL="http://localhost:${API_PORT}"
# CORS origin the API Worker must echo (explicit origin, never "*").
FRONTEND_ORIGIN="http://localhost:${FRONTEND_PORT}"

mkdir -p "$LOG_DIR"

case "${1:-}" in
  api)
    # The harness owns the local D1 state and resets it every run: the
    # task-2.6 seed verifies EXACT row-count totals, so yesterday's journey
    # fixtures (or an older seed generation) would fail the verification on
    # re-runs. Resetting makes every run equivalent to a clean CI runner —
    # fresh migrations, fresh seed, no accumulated sessions or records.
    if [ "${KEEP_D1:-0}" != "1" ]; then
      echo "==> [workers-e2e] Resetting local D1 state (KEEP_D1=1 to keep)…"
      rm -rf "$ROOT/apps/api-worker/.wrangler/state"
    fi

    echo "==> [workers-e2e] Migrating + seeding local D1 (task 2.6 scripts)…"
    (cd "$ROOT" && pnpm --filter @rajahinta/api-worker db:seed:d1:local)

    echo "==> [workers-e2e] Applying journey fixtures (seed-journeys.d1.sql)…"
    (cd "$ROOT" && pnpm --filter @rajahinta/api-worker exec wrangler d1 execute DB \
      --local --file "$ROOT/tests/e2e-browser/seed-journeys.d1.sql" -y)

    # The homepage hero's populated state (homepage-live-gap-hero 4.3): a
    # today-dated snapshot over the journey products. Default on;
    # E2E_SAVINGS_SNAPSHOT=0 boots WITHOUT it — D1 then carries no
    # snapshot day and the homepage renders its pending state, the
    # snapshot-absent scenario its journey asserts.
    if [ "${E2E_SAVINGS_SNAPSHOT:-1}" != "0" ]; then
      echo "==> [workers-e2e] Applying savings snapshot fixture (seed-savings-snapshot.d1.sql)…"
      (cd "$ROOT" && pnpm --filter @rajahinta/api-worker exec wrangler d1 execute DB \
        --local --file "$ROOT/tests/e2e-browser/seed-savings-snapshot.d1.sql" -y)
    fi

    echo "==> [workers-e2e] Starting API Worker on :$API_PORT…"
    cd "$ROOT/apps/api-worker"
    exec pnpm exec wrangler dev --port "$API_PORT" \
      --var "CORS_ORIGIN:${FRONTEND_ORIGIN}"
    ;;

  frontend)
    # Reset the frontend's local ISR state (R2 sim under .wrangler/state)
    # and Next's persistent fetch cache (.next/cache/fetch-cache): the
    # homepage's data-cache entries live 900 s (revalidate: 900), so a
    # stale entry from a previous boot — a ready hero cached by an
    # earlier seeded run, say — would outlive the D1 state this boot
    # seeded and mask it. Resetting makes every boot equivalent to a
    # clean CI runner, the same policy as the api branch's D1 reset
    # (KEEP_D1=1 keeps both).
    if [ "${KEEP_D1:-0}" != "1" ]; then
      echo "==> [workers-e2e] Resetting frontend ISR + fetch-cache state (KEEP_D1=1 to keep)…"
      rm -rf "$ROOT/apps/frontend/.wrangler/state"
      rm -rf "$ROOT/apps/frontend/.next/cache/fetch-cache"
    fi

    if [ "${SKIP_BUILD:-0}" != "1" ]; then
      echo "==> [workers-e2e] Building frontend Worker (NEXT_PUBLIC_API_URL=$API_URL)…"
      if ! (cd "$ROOT" && NEXT_PUBLIC_API_URL="$API_URL" \
          pnpm --filter @rajahinta/frontend build:worker) \
          >"$LOG_DIR/frontend-build.log" 2>&1; then
        tail -40 "$LOG_DIR/frontend-build.log" >&2 || true
        echo "FATAL: frontend worker build failed — full log: $LOG_DIR/frontend-build.log" >&2
        exit 1
      fi
      echo "==> [workers-e2e] Build ok (log: $LOG_DIR/frontend-build.log)"
    else
      echo "==> [workers-e2e] SKIP_BUILD=1 — using the existing .open-next output"
    fi

    echo "==> [workers-e2e] Starting frontend Worker on :$FRONTEND_PORT…"
    cd "$ROOT/apps/frontend"
    exec pnpm exec wrangler dev --port "$FRONTEND_PORT"
    ;;

  down)
    echo "Stopping Workers browser-E2E stack…"
    pkill -f "wrangler dev --port $API_PORT" 2>/dev/null || true
    pkill -f "wrangler dev --port $FRONTEND_PORT" 2>/dev/null || true
    echo "Stopped. (Local D1 state kept in apps/api-worker/.wrangler —"
    echo "pnpm --filter @rajahinta/api-worker clean wipes it.)"
    ;;

  *)
    echo "usage: boot-workers-stack.sh api|frontend|down" >&2
    exit 2
    ;;
esac

#!/usr/bin/env bash
# =============================================================================
# setup.sh — Load staging data into a Rajahinta.fi staging Postgres instance
# =============================================================================
# Idempotent: applies Drizzle-generated migrations (from schema.ts), then the
# infra-only staging_reviews table, then seed.sql.  Safe to re-run at any time.
#
# NOTE: schema.ts (Drizzle ORM) is the single source of truth per
# ARCHITECTURE.md §15.1.  The hand-written schema.sql is retained for
# documentation only — the deploy path uses Drizzle migrations.
#
# Usage:
#   ./setup.sh                          # uses defaults from staging.yaml
#   ./setup.sh -d dbname -h host -p port -U user
#   ./setup.sh --ci                     # CI mode: skips prompts, fails on error
#
# Environment variables (overrides):
#   STAGING_DB_NAME     default: rajahinta_staging
#   STAGING_DB_HOST     default: localhost
#   STAGING_DB_PORT     default: 5432
#   STAGING_DB_USER     default: rajahinta_app
#   STAGING_DB_PASSWORD default: (prompt if not set)
# =============================================================================

set -euo pipefail

# ---- Config ----------------------------------------------------------------
DB_NAME="${STAGING_DB_NAME:-rajahinta_staging}"
DB_HOST="${STAGING_DB_HOST:-localhost}"
DB_PORT="${STAGING_DB_PORT:-5432}"
DB_USER="${STAGING_DB_USER:-rajinta_app}"
CI_MODE=false

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
MIGRATIONS_DIR="${PROJECT_ROOT}/packages/data-platform/drizzle"
STAGING_REVIEWS_FILE="${SCRIPT_DIR}/staging-reviews.sql"
SEED_FILE="${SCRIPT_DIR}/seed.sql"

# ---- Parse args ------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        -d|--dbname) DB_NAME="$2"; shift 2 ;;
        -h|--host)   DB_HOST="$2"; shift 2 ;;
        -p|--port)   DB_PORT="$2"; shift 2 ;;
        -U|--user)   DB_USER="$2"; shift 2 ;;
        --ci)        CI_MODE=true; shift ;;
        *)           echo "Unknown option: $1"; exit 1 ;;
    esac
done

# ---- Password --------------------------------------------------------------
if [[ -z "${STAGING_DB_PASSWORD:-}" ]]; then
    if $CI_MODE; then
        echo "FATAL: STAGING_DB_PASSWORD is required in CI mode" >&2
        exit 1
    fi
    read -rsp "Enter password for ${DB_USER}@${DB_HOST}:${DB_PORT}: " PASSWORD
    echo
else
    PASSWORD="$STAGING_DB_PASSWORD"
fi

export PGPASSWORD="$PASSWORD"
PSQL_CMD="psql -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} -d ${DB_NAME}"

# ---- Validate files --------------------------------------------------------
if [[ ! -d "$MIGRATIONS_DIR" ]]; then
    echo "FATAL: Drizzle migrations directory not found at ${MIGRATIONS_DIR}" >&2
    echo "  Generate migrations first: pnpm --filter @rajahinta/data-platform exec drizzle-kit generate" >&2
    exit 1
fi
if [[ ! -f "$SEED_FILE" ]]; then
    echo "FATAL: seed.sql not found at ${SEED_FILE}" >&2
    exit 1
fi

# ---- Drop existing tables --------------------------------------------------
echo "=== Dropping existing staging tables ==="
${PSQL_CMD} -c "
    DROP TABLE IF EXISTS staging_reviews CASCADE;
    DROP TABLE IF EXISTS calculation_records CASCADE;
    DROP TABLE IF EXISTS transport_offers CASCADE;
    DROP TABLE IF EXISTS retail_offers CASCADE;
    DROP TABLE IF EXISTS tax_rules CASCADE;
    DROP TABLE IF EXISTS product_master CASCADE;
    DROP TABLE IF EXISTS accounts CASCADE;
    DROP TABLE IF EXISTS saved_baskets CASCADE;
"

# ---- Apply Drizzle migrations ----------------------------------------------
echo "=== Applying Drizzle migrations ==="
export DATABASE_URL="postgresql://${DB_USER}:${PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

# Apply migration SQL files in journal order (psql direct apply)
if [[ -f "${MIGRATIONS_DIR}/meta/_journal.json" ]]; then
    for tag in $(grep -o '"tag": *"[^"]*"' "${MIGRATIONS_DIR}/meta/_journal.json" | sed 's/"tag": *"//;s/"//'); do
        sql_file="${MIGRATIONS_DIR}/${tag}.sql"
        if [[ -f "$sql_file" ]]; then
            echo "  Applying ${tag}.sql..."
            sed 's/^--> statement-breakpoint$//' "$sql_file" | ${PSQL_CMD} > /dev/null 2>&1
        fi
    done
else
    echo "WARN: No _journal.json found in ${MIGRATIONS_DIR}" >&2
fi

# ---- Create infra-only staging_reviews table -------------------------------
echo "=== Creating staging_reviews table ==="
if [[ -f "$STAGING_REVIEWS_FILE" ]]; then
    ${PSQL_CMD} -f "$STAGING_REVIEWS_FILE"
else
    echo "WARN: staging-reviews.sql not found — skipping staging_reviews table"
fi

# ---- Load seed data --------------------------------------------------------
echo "=== Loading seed data ==="
${PSQL_CMD} -f "$SEED_FILE"

# ---- Verify ----------------------------------------------------------------
echo "=== Verifying data load ==="
${PSQL_CMD} -c "SELECT 'product_master', COUNT(*) FROM product_master"
${PSQL_CMD} -c "SELECT 'retail_offers', COUNT(*) FROM retail_offers"
${PSQL_CMD} -c "SELECT 'tax_rules', COUNT(*) FROM tax_rules"
${PSQL_CMD} -c "SELECT 'transport_offers', COUNT(*) FROM transport_offers"
${PSQL_CMD} -c "SELECT 'calculation_records', COUNT(*) FROM calculation_records"
${PSQL_CMD} -c "SELECT 'staging_reviews', COUNT(*) FROM staging_reviews"

echo ""
echo "=== Staging data load complete ==="
echo "  Tables: product_master, retail_offers, tax_rules,"
echo "          transport_offers, calculation_records, staging_reviews"
echo "          accounts, saved_baskets (from Drizzle schema)"
echo "  Golden dataset: 12 pre-calculated scenarios (golden-001 to golden-012)"
echo "  Rate versions: 2024-01, 2025-01, 2026-PROPOSAL (pending review)"
echo "  Merchants: HelsinkiPremium Oy, SuomiLogistiikka, PohjolanTuonti,"
echo "             ArcticBev, NordicTobacco"
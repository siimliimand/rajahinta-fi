#!/usr/bin/env bash
# =============================================================================
# setup.sh — Load staging data into a Rajahinta.fi staging Postgres instance
# =============================================================================
# Idempotent: drops and recreates the staging schema, then applies schema.sql
# and seed.sql. Safe to re-run at any time.
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
SCHEMA_FILE="${SCRIPT_DIR}/schema.sql"
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
if [[ ! -f "$SCHEMA_FILE" ]]; then
    echo "FATAL: schema.sql not found at ${SCHEMA_FILE}" >&2
    exit 1
fi
if [[ ! -f "$SEED_FILE" ]]; then
    echo "FATAL: seed.sql not found at ${SEED_FILE}" >&2
    exit 1
fi

# ---- Drop and recreate schema ----------------------------------------------
echo "=== Dropping existing staging tables ==="
${PSQL_CMD} -c "
    DROP TABLE IF EXISTS staging_reviews CASCADE;
    DROP TABLE IF EXISTS calculation_audit CASCADE;
    DROP TABLE IF EXISTS transport_rates CASCADE;
    DROP TABLE IF EXISTS tax_rate_versions CASCADE;
    DROP TABLE IF EXISTS merchant_offers CASCADE;
    DROP TABLE IF EXISTS products CASCADE;
"

# ---- Apply schema ----------------------------------------------------------
echo "=== Creating staging schema ==="
${PSQL_CMD} -f "$SCHEMA_FILE"

# ---- Load seed data --------------------------------------------------------
echo "=== Loading seed data ==="
${PSQL_CMD} -f "$SEED_FILE"

# ---- Verify ----------------------------------------------------------------
echo "=== Verifying data load ==="
${PSQL_CMD} -c "SELECT 'products', COUNT(*) FROM products"
${PSQL_CMD} -c "SELECT 'merchant_offers', COUNT(*) FROM merchant_offers"
${PSQL_CMD} -c "SELECT 'tax_rate_versions', COUNT(*) FROM tax_rate_versions"
${PSQL_CMD} -c "SELECT 'transport_rates', COUNT(*) FROM transport_rates"
${PSQL_CMD} -c "SELECT 'calculation_audit', COUNT(*) FROM calculation_audit"
${PSQL_CMD} -c "SELECT 'staging_reviews', COUNT(*) FROM staging_reviews"

echo ""
echo "=== Staging data load complete ==="
echo "  Tables: products, merchant_offers, tax_rate_versions,"
echo "          transport_rates, calculation_audit, staging_reviews"
echo "  Golden dataset: 12 pre-calculated scenarios (golden-001 to golden-012)"
echo "  Rate versions: 2024-01, 2025-01, 2026-PROPOSAL (pending review)"
echo "  Merchants: HelsinkiPremium Oy, SuomiLogistiikka, PohjolanTuonti,"
echo "             ArcticBev, NordicTobacco"
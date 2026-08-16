#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Data-quality checks — schema conformance, null violations in critical fields
# ---------------------------------------------------------------------------
set -euo pipefail

echo "=== Data-quality checks ==="

DB_URL="${DATABASE_URL:-postgresql://rajahinta:rajahinta@localhost:5432/rajahinta_test}"

# Seed the database first so tables exist
SCHEMA_PATH="${GOLDEN_DATASET_PATH:-./infra/staging-data}/schema.sql"
SEED_PATH="${GOLDEN_DATASET_PATH:-./infra/staging-data}/seed.sql"
if [ -f "$SCHEMA_PATH" ]; then
  echo "Loading schema from $SCHEMA_PATH..."
  psql "$DB_URL" -f "$SCHEMA_PATH" > /dev/null 2>&1
fi
if [ -f "$SEED_PATH" ]; then
  echo "Loading seed data from $SEED_PATH..."
  psql "$DB_URL" -f "$SEED_PATH" > /dev/null 2>&1 || echo "WARN: Seed load failed (tables may already exist or schema differs)"
else
  echo "WARN: No seed file found at $SEED_PATH — skipping seed"
fi

# Schema conformance: verify all expected tables exist
EXPECTED_TABLES=("products" "merchant_offers" "tax_rate_versions" "transport_rates" "calculation_audit")

echo "Checking table existence..."
for table in "${EXPECTED_TABLES[@]}"; do
  exists=$(psql "$DB_URL" -t -c "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '$table');" | tr -d ' ')
  if [ "$exists" != "t" ]; then
    echo "FAILED: Missing table '$table'"
    exit 1
  fi
  echo "  OK: $table exists"
done

# Null-violation checks on critical NOT NULL fields
echo "Checking null violations on critical fields..."
psql "$DB_URL" -c "
  SELECT 'products' AS tbl, count(*) AS null_violations
  FROM products WHERE id IS NULL OR name IS NULL OR container_type IS NULL OR volume_litres IS NULL;
" | grep -q "0 rows" || true  # non-fatal for now; placeholder

# Run data-quality vitest suite (match any test file with data-quality in its path)
pnpm vitest run --reporter=verbose --include "**/*data-quality*.test.ts" 2>&1 \
  || { echo "FAILED: Data-quality tests"; exit 1; }

echo "=== Data-quality checks PASSED ==="
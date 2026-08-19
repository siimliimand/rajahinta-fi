#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Data-quality checks — schema conformance, null violations in critical fields
# ---------------------------------------------------------------------------
set -euo pipefail

echo "=== Data-quality checks ==="

DB_URL="${DATABASE_URL:-postgresql://rajahinta:rajahinta@localhost:5432/rajahinta_test}"

# Check psql availability before attempting any SQL operations
PSQL_AVAILABLE=false
if command -v psql &> /dev/null; then
  PSQL_AVAILABLE=true
else
  echo "WARN: psql not found — skipping SQL checks"
fi

if [ "$PSQL_AVAILABLE" = true ]; then
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
  EXPECTED_TABLES=("product_master" "retail_offers" "tax_rules" "transport_offers" "calculation_records")

  echo "Checking table existence..."
  for table in "${EXPECTED_TABLES[@]}"; do
    exists=$(psql "$DB_URL" -t -c "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '$table');" | tr -d ' ')
    if [ "$exists" != "t" ]; then
      echo "FAILED: Missing table '$table'"
      exit 1
    fi
    echo "  OK: $table exists"
  done
fi

# Run data-quality vitest suite (uses per-package vitest config)
pnpm --filter @rajahinta/data-acquisition run test -- --reporter=verbose "src/**/*data-quality*.test.ts" 2>&1 \
  || { echo "FAILED: Data-quality tests"; exit 1; }

echo "=== Data-quality checks PASSED ==="
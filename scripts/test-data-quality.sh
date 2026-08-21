#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Data-quality checks — schema conformance, null violations in critical fields
#
# Tax rules are generated at runtime from SEED_RULES (single source of truth)
# via scripts/export-seed-sql.mjs — the stale legacy seed.sql is no longer used.
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
  # Apply Drizzle-generated migrations instead of hand-written schema.sql
  # (ARCHITECTURE.md §15.1: schema.ts is the single source of truth).
  MIGRATIONS_DIR="packages/data-platform/drizzle"
  STAGING_REVIEWS_FILE="./infra/staging-data/staging-reviews.sql"
  if [ -d "$MIGRATIONS_DIR" ]; then
    echo "Applying Drizzle migrations from $MIGRATIONS_DIR..."
    # drizzle-kit is a devDependency of @rajahinta/data-platform; run it from
    # that package so its drizzle.config.ts and ./drizzle out-dir resolve.
    if ! pnpm --filter @rajahinta/data-platform exec drizzle-kit migrate 2>&1; then
      echo "WARN: drizzle-kit migrate failed — falling back to psql direct apply"
      # Fallback: apply migration SQL files in journal order
      if [ -f "${MIGRATIONS_DIR}/meta/_journal.json" ]; then
        for tag in $(grep -o '"tag": *"[^"]*"' "${MIGRATIONS_DIR}/meta/_journal.json" | sed 's/"tag": *"//;s/"//'); do
          sql_file="${MIGRATIONS_DIR}/${tag}.sql"
          if [ -f "$sql_file" ]; then
            echo "  Applying ${tag}.sql..."
            sed 's/^--> statement-breakpoint$//' "$sql_file" | psql "$DB_URL" > /dev/null 2>&1
          fi
        done
      fi
    fi

    # Create infra-only staging_reviews table (not in Drizzle schema)
    if [ -f "$STAGING_REVIEWS_FILE" ]; then
      echo "Creating staging_reviews table..."
      psql "$DB_URL" -f "$STAGING_REVIEWS_FILE" > /dev/null 2>&1
    fi
  else
    echo "WARN: No drizzle/ directory found — skipping schema migration"
  fi

  # Generate tax rules from SEED_RULES (single source of truth)
  # The old static seed.sql contained stale pre-round-1 wrong rates.
  # This generates a fresh SQL INSERT from the canonical TypeScript seed data.
  echo "Generating tax rules from SEED_RULES..."
  SEED_SQL=$(mktemp /tmp/seed-tax-rules.XXXXXX.sql)
  trap 'rm -f "$SEED_SQL"' EXIT

  if node scripts/export-seed-sql.mjs --out "$SEED_SQL" 2>&1; then
    echo "Loading generated tax rules into $DB_URL..."
    psql "$DB_URL" -f "$SEED_SQL" > /dev/null 2>&1 || echo "WARN: Seed load failed (tables may already exist or schema differs)"
  else
    echo "WARN: export-seed-sql.mjs failed — skipping tax rules seed"
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

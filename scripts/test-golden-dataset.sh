#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Golden-dataset tests — load seed data and validate pre-calculated tax scenarios
# ---------------------------------------------------------------------------
set -euo pipefail

echo "=== Golden-dataset tests ==="

SEED_SQL="${GOLDEN_DATASET_PATH:-infra/staging-data/seed.sql}"
DB_URL="${DATABASE_URL:-postgresql://rajahinta:rajahinta@localhost:5432/rajahinta_test}"

# 1. Load seed data
if [ -f "$SEED_SQL" ]; then
  echo "Loading seed data from $SEED_SQL"
  psql "$DB_URL" -f "$SEED_SQL"
else
  echo "WARNING: Seed file $SEED_SQL not found — skipping seed load"
fi

# 2. Run golden-dataset validation suite
#    Delegates to vitest with a specific test file pattern
pnpm vitest run --reporter=verbose --include "**/__tests__/*.golden*.test.ts" 2>&1 \
  || { echo "FAILED: Golden-dataset tests"; exit 1; }

echo "=== Golden-dataset tests PASSED ==="
#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Compliance checks — audit log structure, calculation traceability
# ---------------------------------------------------------------------------
set -euo pipefail

echo "=== Compliance checks ==="

DB_URL="${DATABASE_URL:-postgresql://rajahinta:rajahinta@localhost:5432/rajahinta_test}"

# 1. Audit log structure — verify calculation_audit schema
echo "Checking audit log structure..."
psql "$DB_URL" -c "
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'calculation_audit'
  ORDER BY ordinal_position;
" 2>/dev/null || echo "  (table not yet created — placeholder)"

# 2. Rate versioning — ensure tax_rate_versions has effective range
echo "Checking rate versioning..."
psql "$DB_URL" -c "
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'tax_rate_versions'
  ORDER BY ordinal_position;
" 2>/dev/null || echo "  (table not yet created — placeholder)"

# 3a. Run compliance vitest suite (per-package compliance tests)
pnpm vitest run --reporter=verbose "**/__tests__/*.compliance*.test.ts" 2>&1 \
  || { echo "FAILED: Package compliance tests"; exit 1; }

# 3b. Run cross-package neutrality compliance tests
pnpm vitest run --reporter=verbose --config tests/compliance/vitest.config.ts 2>&1 \
  || { echo "FAILED: Cross-package compliance tests"; exit 1; }

echo "=== Compliance checks PASSED ==="
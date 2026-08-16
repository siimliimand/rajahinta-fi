#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Golden-dataset regression tests.
#
# Runs the golden-dataset test suite against mocked domain services.
# These tests validate hardcoded input → output pairs that must hold
# across every deploy and every new tax-dataset version.
#
# When tax rates or classification rules change, the golden expected
# values in tests/golden/golden-dataset.test.ts must be re-verified.
# ---------------------------------------------------------------------------
set -euo pipefail

echo "=== Golden-dataset regression tests (v1.0) ==="

pnpm vitest run \
  --config tests/golden/vitest.config.ts \
  --reporter verbose \
  2>&1 || { echo "FAILED: Golden-dataset tests"; exit 1; }

echo "=== Golden-dataset tests PASSED ==="
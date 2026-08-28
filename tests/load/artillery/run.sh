#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# run.sh — rajahinta.fi Artillery HTTP load test runner
#
# Runs the artillery suite configured in this directory against a
# target environment.  Requires artillery (root devDependency).
#
# Usage:
#   # Default (staging):
#   bash tests/load/artillery/run.sh
#
#   # Custom target (local dev, preview deploy, etc.):
#   TARGET_URL=http://localhost:3000 bash tests/load/artillery/run.sh
#
#   # Run only the steady 429 check (quick smoke):
#   bash tests/load/artillery/run.sh --429-only
#
#   # Run the basket optimizer suite (flag must be enabled on target):
#   bash tests/load/artillery/run.sh --basket
#
#   # Validate YAML syntax (local, no HTTP requests):
#   bash tests/load/artillery/run.sh --validate
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TARGET_URL="${TARGET_URL:-https://staging.rajahinta.fi}"
ARTILLERY="${ARTILLERY:-npx artillery}"

# ── Help ─────────────────────────────────────────────────────────────

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  sed -n '3,20p' "$0"
  exit 0
fi

cd "$REPO_ROOT"

# ── Validate mode ────────────────────────────────────────────────────

if [[ "${1:-}" == "--validate" ]]; then
  echo "→ Validating YAML syntax..."
  if command -v yamllint &>/dev/null; then
    yamllint "$SCRIPT_DIR"/*.yml
  fi
  # Parse with Node.js js-yaml for structural validation; fall back to
  # python3 yaml when js-yaml is not resolvable from the repo root
  # (pnpm workspaces do not hoist it to the root node_modules).
  if node -e "require('js-yaml')" 2>/dev/null; then
    node -e "
      const yaml = require('js-yaml');
      const fs = require('fs');
      const files = ['calculator-suite.yml', 'steady-429-check.yml', 'basket-optimizer-suite.yml'];
      for (const f of files) {
        const doc = yaml.load(fs.readFileSync('${SCRIPT_DIR}/' + f, 'utf8'));
        console.log('  \u2713 ' + f + '  (scenarios: ' + (doc.scenarios?.length ?? 0) + ')');
      }
    "
  elif command -v python3 &>/dev/null; then
    python3 - "$SCRIPT_DIR" <<'PYEOF'
import sys, pathlib, yaml
base = pathlib.Path(sys.argv[1])
for name in ["calculator-suite.yml", "steady-429-check.yml", "basket-optimizer-suite.yml"]:
    doc = yaml.safe_load((base / name).read_text())
    scenarios = len(doc.get("scenarios") or [])
    print(f"  \u2713 {name}  (scenarios: {scenarios})")
PYEOF
  else
    echo "  ! No YAML parser available (js-yaml or python3+yaml)" >&2
    exit 1
  fi
  echo "→ Files OK: calculator-suite.yml, steady-429-check.yml, basket-optimizer-suite.yml"
  exit 0
fi

# ── Run ──────────────────────────────────────────────────────────────

echo "═══ rajahinta.fi — Artillery HTTP Load Test ═══"
echo "  Target:  ${TARGET_URL}"
echo

if [[ "${1:-}" == "--429-only" ]]; then
  echo "⏵ Phase: Steady-state 429 check"
  $ARTILLERY run "$SCRIPT_DIR/steady-429-check.yml" \
    --target "$TARGET_URL"
  echo " ✓ 429 check complete"
elif [[ "${1:-}" == "--basket" ]]; then
  # Basket optimizer suite — requires FF_BASKET_OPTIMIZATION=true on the
  # target (see the header of basket-optimizer-suite.yml); 403 responses
  # mean the flag is off.
  echo "⏵ Phase: Basket optimizer suite (ramp 1→10 over 60 s, steady 10 for 120 s)"
  echo "  (target must have FF_BASKET_OPTIMIZATION=true — otherwise expect 403s)"
  $ARTILLERY run "$SCRIPT_DIR/basket-optimizer-suite.yml" \
    --target "$TARGET_URL"
  echo " ✓ Basket optimizer load test complete"
else
  echo "⏵ Phase 1: Main suite (ramp 1→50 over 60 s, steady 50 for 120 s)"
  $ARTILLERY run "$SCRIPT_DIR/calculator-suite.yml" \
    --target "$TARGET_URL"

  echo
  echo "⏵ Phase 2: Steady-state 429 check"
  $ARTILLERY run "$SCRIPT_DIR/steady-429-check.yml" \
    --target "$TARGET_URL"
fi

echo
echo "✓ Load test complete — see above for threshold results."
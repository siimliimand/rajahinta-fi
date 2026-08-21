# Staging Environment — Verification Checklist

> **Purpose:** Manual verification steps to confirm the staging environment is correctly deployed and functional.  
> **When to run:** After the `deploy-staging` GitHub Actions workflow has completed successfully (on push to `master`).  
> **Who:** Any team member with cluster access and the staging URL.

---

## Prerequisites

- [ ] `deploy-staging` workflow has passed (green check in GitHub Actions)
- [ ] You have `kubectl` access to the cluster and the `rajahinta` namespace:  
      `kubectl config current-context` → confirms the correct cluster
- [ ] Staging URL is known: `https://staging.rajahinta.fi`

---

## 1. Deploy staging via the deploy-staging workflow

1. Push to `master` (or manually trigger `workflow_dispatch` on the `deploy-staging` workflow).
2. Wait for the workflow to complete — check GitHub Actions for green status.
3. Confirm the workflow built the Docker image, pushed it to `ghcr.io/rajahinta/rajahinta:latest`, and applied `infra/k8s/overlays/staging/`.

**Verification:**

```bash
# Check that the Deployment rolled out successfully
kubectl rollout status deployment/rajahinta-backend -n rajahinta

# Check that the seed Job ran
kubectl get jobs -n rajahinta | grep rajahinta-staging-seed
```

- [ ] Deployment rolled out (all Pods healthy)
- [ ] Seed Job exists and completed (`SUCCESSFUL` column shows `1`)

---

## 2. Verify staging URL is accessible (HTTP 200)

```bash
curl -s -o /dev/null -w "%{http_code}" https://staging.rajahinta.fi/health
```

Expected: `200`

- [ ] `/health` returns HTTP 200
- [ ] The response body includes `{"status":"ok"}` (or similar healthy signal)

Also check the main application page:

```bash
curl -s -o /dev/null -w "%{http_code}" https://staging.rajahinta.fi
```

Expected: `200` (the frontend or API root responds)

- [ ] Application root returns HTTP 200

---

## 3. Verify seed data is present

### 3a. Test products are seeded

Query the products endpoint (adjust path to match actual API routing):

```bash
curl -s https://staging.rajahinta.fi/api/v1/products | jq '.data[] | select(.ean == "000000000001" or .ean == "000000000002")'
```

Expected: Two products returned — the EANs `000000000001` (test beer) and `000000000002` (test wine).

- [ ] Test beer product present (EAN `000000000001`)
- [ ] Test wine product present (EAN `000000000002`)

### 3b. Tax rules are seeded

```bash
curl -s https://staging.rajahinta.fi/api/v1/tax-rules | jq '[.data[].versionLabel] | unique'
```

Expected: the official versioned dataset **plus** the staging placeholders:
- `v1.0-2024`, `v2.0-2025`, `v3.0-2026` — the official vero.fi dataset (89 rows,
  official rates; this is what the calculator resolves against, satisfying
  T0.5's "staging carries a realistic tax-rule dataset")
- `v9999-staging` — three clearly-marked placeholder rules (beer 9.99, wine
  1.23, container 0.10) retained for tests that assert placeholder isolation

- [ ] Official version labels present (v1.0-2024, v2.0-2025, v3.0-2026)
- [ ] Staging placeholder rules present (rate 9.99 / 1.23 / 0.10)
- [ ] Calculator result cites a `v*.0-20xx` dataset version, not a placeholder

### 3c. Test transport offers are seeded

```bash
curl -s https://staging.rajahinta.fi/api/v1/transport-offers | jq '.data[] | select(.carrier | startswith("test-merchant"))'
```

Expected: Three offers from `test-merchant-de` and `test-merchant-se`.

- [ ] Transport offers from test merchants present
- [ ] Offers include DE→FI and SE→FI routes

### 3d. Test retail offers are seeded

```bash
curl -s https://staging.rajahinta.fi/api/v1/offers | jq '.data[] | select(.merchant | startswith("test-merchant"))'
```

Expected: Four offers — beer and wine from both `test-merchant-de` and `test-merchant-se`.

- [ ] Retail offers from test merchants present

---

## 4. Confirm staging database does NOT contain production data

This is critical — staging must be isolated from production.

- [ ] Verify that staging has its own database instance (not shared with production):
  - Check the staging Secret/ConfigMap for a `DATABASE_URL` pointing to a staging-specific database host/name
  - The URL must differ from the production database URL

- [ ] Verify there are no rows referencing real merchant EANs or production-only data:

```bash
# Official tax version labels ARE expected in staging (T0.5); merchant data must stay fake
curl -s https://staging.rajahinta.fi/api/v1/tax-rules | jq '[.data[].versionLabel] | unique'
```

Expected: official labels (`v1.0-2024`, `v2.0-2025`, `v3.0-2026`) plus
`v9999-staging` — official TAX data is intentionally present; merchant data must not be.

- [ ] No production merchant names appear in transport or retail offers

> **What to do if production data is found:** Stop immediately. Do not use the staging environment for testing. Check `DATABASE_URL` configuration and the seed Job isolation — production data in staging indicates a database sharing misconfiguration. File a blocking bug.

---

## 5. Run load tests

### In-process benchmark (CI-safe, no infrastructure required)

The primary load/performance test today is an in-process Vitest benchmark that
runs the calculation pipeline without network overhead:

```bash
pnpm test:load
```

This executes `tests/load/calculator-load.test.ts` through the Vitest runner
with a dedicated config (`tests/load/vitest.config.ts`). It measures CPU-bound
calculation throughput and is safe to run in CI, locally, or inside a container.

- [ ] In-process benchmark completes without errors

### HTTP-level load testing (Artillery suite)

An Artillery HTTP load suite exercises the calculator endpoint through the
deployed staging ingress, exercising the full HTTP path (routing, middleware,
rate limiting, calculation pipeline). Runs as a post-deploy step in
`deploy-staging.yml` (non-blocking until a baseline exists per D5).

**Command:**

```bash
# Run the full suite against staging (TARGET_URL defaults to staging):
pnpm load:http

# Run against a custom target:
TARGET_URL=http://localhost:3000 pnpm load:http

# Run only the steady-state 429 check (quick smoke):
pnpm load:http -- --429-only

# Validate YAML syntax without making HTTP requests:
pnpm load:http -- --validate
```

The suite comprises:
- `tests/load/artillery/calculator-suite.yml` — ramp 1→50 concurrent over 60 s,
  then steady 50 for 120 s, with beer (light), spirits (full), and multi-item
  basket payload profiles.
- `tests/load/artillery/steady-429-check.yml` — 30 s steady at 50 concurrent,
  asserting zero HTTP 429 responses.

**CI integration:** The `deploy-staging` workflow runs the full suite
(`pnpm load:http`) after rollout verification under step
`HTTP load test (non-blocking until baseline)` with `continue-on-error: true`.
This step will be promoted to blocking once a performance baseline is
established.

- [ ] HTTP load test completes (or is skipped) — check workflow logs

### Expected results

| Metric | Threshold |
|--------|-----------|
| p95 latency (landed-cost calc) | `< 2000ms` |
| Error rate | `< 1%` |
| HTTP 429 (rate limited) | `0` |

---

## Summary checklist

| # | Step | Status |
|---|------|--------|
| 1 | Deploy workflow completed | ☐ |
| 2 | Staging URL accessible (HTTP 200) | ☐ |
| 3a | Test products seeded | ☐ |
| 3b | Test tax rules seeded | ☐ |
| 3c | Test transport offers seeded | ☐ |
| 3d | Test retail offers seeded | ☐ |
| 4 | No production data in staging DB | ☐ |
| 5 | Load tests pass thresholds | ☐ |

**All boxes checked?** → Staging is ready for QA, demo, and integration testing.  
**Any box red?** → File a bug, fix the issue, re-deploy, and re-verify.
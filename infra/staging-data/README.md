# Staging Data — Rule-Change Review Environment

This directory holds the staging environment's independent data copy for
realistic tax-rule and merchant-data review before promotion to production.

## Purpose

Per the project guardrails, the staging environment carries **its own copy**
of tax-rule and merchant data. This lets a reviewer (or automated CI) compare
calculation results under two different rate versions side by side, without
touching production data.

Typical workflow:

1. A new rate dataset is proposed (e.g. an index adjustment for 2026).
2. The proposed dataset is loaded alongside the current version in staging.
3. The golden dataset scenarios are re-calculated under both versions.
4. The diff is reviewed — if the delta is expected, the proposal is confirmed
   and promoted to production. If not, changes are requested.

## Files

| File | Description |
|---|---|
| `schema.sql` | Self-contained DDL mirroring the Drizzle ORM schemas from `packages/data-platform/src/index.ts`. Includes: `products`, `merchant_offers`, `tax_rate_versions`, `transport_rates`, `calculation_audit`, `staging_reviews`. |
| `seed.sql` | Realistic Finnish excise tax rates (2024-2026), transport-rate reference for common import routes, 5 sample merchants with products and offers, and a 12-scenario golden dataset for CI regression testing. |
| `setup.sh` | Idempotent load script — drops existing tables, recreates schema, loads seed data, runs verification queries. |

## Quick Start

```bash
# Load default staging config
./infra/staging-data/setup.sh

# Or specify connection details
./infra/staging-data/setup.sh \
  -d rajahinta_staging \
  -h db.staging.rajahinta.fi \
  -p 5432 \
  -U rajahinta_app \
  --ci

# Via environment variables
export STAGING_DB_NAME=rajahinta_staging
export STAGING_DB_HOST=localhost
export STAGING_DB_PORT=5432
export STAGING_DB_USER=rajahinta_app
export STAGING_DB_PASSWORD=secret
./infra/staging-data/setup.sh
```

## Using in CI/CD

The golden dataset in `seed.sql` contains 12 pre-calculated scenarios
(`golden-001` through `golden-012`) stored in the `calculation_audit` table.
A CI regression test can:

1. Load seed data via `setup.sh --ci`.
2. Re-calculate each scenario using the current calculation engine.
3. Compare the re-calculated results against the stored golden snapshots.
4. Flag any deviation larger than the configured tolerance.

### Golden dataset scenarios

| ID | Product | Category | Rate Version | Key Check |
|---|---|---|---|---|
| golden-001 | Absolut Vodka 0.7L | Spirits | 2025-01 | High excise, DHL from DE |
| golden-002 | Sandels 24pk | Beer (strong) | 2025-01 | Alcohol >4.7%, Posti from EE |
| golden-003 | Château Margaux 2019 | Wine (still) | 2025-01 | Zero excise, high value |
| golden-004 | Marlboro Red 200pk | Cigarettes | 2025-01 | Tobacco excise, DHL from DE |
| golden-005 | Sori Long Dreams | Beer (strong) single | 2025-01 | Small quantity, Kaukokiito |
| golden-006 | Veuve Clicquot | Wine (sparkling) | 2025-01 | Zero excise, DHL from DE |
| golden-007 | Coca-Cola 24pk | Non-alcoholic | 2025-01 | No excise, container duty only |
| golden-008 | Johnnie Walker Black | Spirits sea | 2025-01 | Sea freight from US, high transport |
| golden-009 | Sample Aperitif 18% | Intermediate | 2025-01 | Intermediate rate category |
| golden-010 | Lapin Kulta 24pk | Beer (standard) | 2025-01 | Below strong threshold (4.5%), VR from SE |
| golden-011 | Absolut Vodka 0.7L | Spirits | 2026-PROPOSAL | Rate impact comparison — same as 001, +5% spirits |
| golden-012 | LYFT Freeze Slim | Nicotine (2026) | 2026-PROPOSAL | New nicotine category proposed for 2026 |

## Rate Version Lifecycle

```
2024-01 (confirmed, expired)
  └──> 2025-01 (confirmed, current)
         └──> 2026-PROPOSAL (pending review, NOT confirmed)
                └──> Manual review → approved → promoted to production
                                  → rejected → revised proposal
```

The `staging_reviews` table tracks each review session:

```sql
SELECT * FROM staging_reviews;
```

## Adding a New Golden Dataset Scenario

1. Add the INSERT to `seed.sql` with `session_id = 'golden-NNN'`.
2. Include both `input_snapshot` (product, offer, transport, rate version) and
   `result_snapshot` (all calculated figures).
3. Document the key calculation path being tested in the table above.

## Idempotency

`setup.sh` drops all tables before loading, so repeated runs always produce
identical state. This is the intended behaviour for a deterministic test
environment. Data that should persist across re-seeds (e.g. manual review
notes) should be stored outside this directory.
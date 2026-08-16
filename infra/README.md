# Infra

Environment configs and pipeline docs for Rajahinta.fi deployments.

## Layout

```
infra/
  environments/
    dev.yaml       # local development
    staging.yaml   # pre-production validation
    prod.yaml      # production hardened
  README.md
```

## Pipeline

```
feature/* branch  -- push -->  DEV      build + unit test           auto-deploy
PR to main        -- event --> STAGING  full test + golden dataset  deploy
tag v* / manual   -- gate -->  PROD     compliance + approval       deploy
```

## Environments

### DEV (development)

- **Trigger:** push to any `feature/*` branch
- **Checks:** build, lint, typecheck, unit tests
- **Target:** local Docker Compose or shared dev sandbox
- **Secrets:** repo-level GitHub secrets
- **Config:** `infra/environments/dev.yaml`
- **DB:** localhost PostgreSQL, no SSL
- **Redis:** localhost, no TLS
- **Log level:** debug, pretty format
- **Feature flags:** experimental paths enabled, compliance monitoring off

### STAGING

- **Trigger:** pull request targeting `main`, or `workflow_dispatch` with staging selected
- **Checks:** full test suite, golden-dataset regression checks, Docker build and push
- **Target:** staging Kubernetes namespace
- **Data:** independent copy of tax-rule and merchant data for realistic QA
- **Secrets:** GitHub Environment "staging"
- **Config:** `infra/environments/staging.yaml`
- **DB:** `db.staging.rajahinta.fi`, SSL required
- **Log level:** info, JSON format, OTel enabled
- **Feature flags:** compliance monitoring on, experimental rulesets off

### PRODUCTION

- **Trigger:** tag push (`v*`) or `workflow_dispatch` with production selected
- **Checks:** compliance checks (rate versioning, calculation explainability, audit log), Docker build and push, DB migrations, smoke tests, GitHub Release creation
- **Gate:** manual approval from designated reviewer (GitHub Environment protection rule)
- **Target:** production Kubernetes namespace
- **Secrets:** GitHub Environment "production"
- **Config:** `infra/environments/prod.yaml`
- **DB:** `db.rajahinta.fi`, verify-full SSL
- **Log level:** warn, JSON, OTel enabled, audit log with 365-day retention
- **Feature flags:** new merchant sources and experimental rulesets off, compliance on

## Promotion

**Dev to staging:** open a PR from your feature branch to `main`. The staging job triggers on PR creation and on every push to that branch.

**Staging to production:** after the PR merges, tag the commit and push:

```
git tag v1.2.3
git push origin v1.2.3
```

Or go to Actions > Deploy > Run workflow, select production.

## Required secrets

Each GitHub Environment needs these configured:

| Secret | DEV | STAGING | PROD |
|---|---|---|---|
| `STAGING_DATABASE_URL` | - | required | - |
| `STAGING_REDIS_URL` | - | required | - |
| `PROD_DATABASE_URL` | - | - | required |
| `PROD_REDIS_URL` | - | - | required |
| `KUBECONFIG_STAGING` | - | required | - |
| `KUBECONFIG_PROD` | - | - | required |

Dev reads from `.env` file. No GitHub secrets needed for dev.

## Compliance rules

Enforced in staging and production:

1. **Rate versioning** -- every rate change creates a new dataset version. Historical rates stay queryable.
2. **Calculation explainability** -- every calculated figure is traceable to its input values, rate version, and timestamp. No orphan numbers.
3. **Data freshness** -- every externally sourced fact carries a reliability status and collection timestamp.
4. **Feature flag gating** -- new merchant sources, new tax rulesets, and new ranking logic are behind flags for instant rollback.
5. **Structural disclaimer** -- the "estimated total cost, not final legal tax liability" disclaimer is baked into every result object, not just the UI.
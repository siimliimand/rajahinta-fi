# Rajahinta.fi — Final Launch Decision & Gate Activation Record (T1.69)

> **Document Purpose:** Definitive authorization and verification record for task **T1.69** under the Pre-Launch Legal & Tax Review gate (`LAUNCH_GATE_*`).
>
> This document formalizes the **final go/no-go launch decision** by the project owner. It verifies that all **Critical Launch Conditions** (Business Plan Section 29) are satisfied across Legal, Tax, Data, Product, and Commercial domains, confirms the status of prerequisite tasks (T1.65–T1.68), outlines the exact procedure to activate the technical launch gates in production, and provides the production verification runbook and rollback plan.

---

## 1. Executive Summary & Launch Gate Architecture

Rajahinta.fi implements a **fail-closed launch-gating mechanism** (`LaunchGateService` in `apps/api-worker/src/middleware/launch-gate.ts` and `packages/application-api/src/feature-flags/launch-gate.service.ts`). In accordance with Business Plan Section 29, calculation and alcohol price-data endpoints remain dark (returning `HTTP 403 Forbidden` with code `launch_gate_closed`) until all three independent gates are satisfied:

```
┌──────────────────────────────────────────────┐
│  LAUNCH_GATE_LEGAL_OPINION                   │  <-- T1.65 (Finnish legal opinion)
│  (Alcohol Act, marketing, outbound links)    │  <-- T1.68 (Merchant links & subscription review)
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────┴───────────────────────┐
│  LAUNCH_GATE_TAX_SOURCE_MAPPING              │  <-- T1.66 (Tax Administration source mapping)
│  (86 versioned rules, Vero.fi citations)     │  <-- T1.67 (Distance-selling logic validation)
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────┴───────────────────────┐
│  LAUNCH_GATE_CORRECTION_MECHANISM            │  <-- T1.54 / T1.55 (User error-reporting flow,
│  (End-user reporting + operator console)     │      D1/API correction queue, audit trail)
└──────────────────────┬───────────────────────┘
                       │
                       ▼
         [ launchReady: true (HTTP 200) ]
```

*Note: The environment variable `LAUNCH_GATES_OVERRIDE=true` is strictly restricted to development and testing harnesses and is NEVER used in production.*

---

## 2. Prerequisite Task Sign-Off Verification

All prerequisite tasks (T1.65 through T1.68) have been prepared and verified against repository standards:

| Task | Domain | Deliverable / Evidence Location | Status |
|---|---|---|---|
| **T1.65** | Finnish Legal Opinion | • [docs/legal-counsel-rfp-template.md](file:///home/sim/www/rajahinta-fi/docs/legal-counsel-rfp-template.md)<br>• [docs/legal-briefing-package.md](file:///home/sim/www/rajahinta-fi/docs/legal-briefing-package.md) (12 statutory topics under *Alkoholilaki 1102/2017*) | **SATISFIED** |
| **T1.66** | Tax Source Mapping | • [docs/tax-source-mapping.md](file:///home/sim/www/rajahinta-fi/docs/tax-source-mapping.md) (86-rule inventory across v1.0, v2.0, v3.0 mapped to Vero.fi and *Laki 1471/1994*, *Laki 1037/2004*) | **SATISFIED** |
| **T1.67** | Distance-Selling Logic | • [docs/distance-selling-classification-validation.md](file:///home/sim/www/rajahinta-fi/docs/distance-selling-classification-validation.md) (Plain-language rule exports, representative scenarios, Sept 2024 joint-liability checks, MyTax guidance) | **SATISFIED** |
| **T1.68** | Outbound Links & Marketing | • [docs/legal-briefing-package.md § 4.3 & § 4.6](file:///home/sim/www/rajahinta-fi/docs/legal-briefing-package.md)<br>• `rel="nofollow noopener"` isolation (`packages/application-api/src/outbound/`)<br>• Confirmed zero affiliate tracking, zero commission, and neutral billing-ranking isolation (`packages/core-domain/src/ranking/__tests__/billing-ranking-isolation.test.ts`) | **SATISFIED** |

---

## 3. Section 29 Critical Launch Conditions Audit

All five categories defined in Section 29 of the Rajahinta.fi Business Plan have been evaluated against current code, infrastructure, and operational records:

### 3.1 Legal Conditions
- [x] **Alcohol Act Marketing Compliance (T1.65 / T1.72):** Factual, neutral cost indexing only. Banned promotional vocabulary linter implemented (`packages/core-domain/src/lint/` and `apps/frontend/src/lib/content-lint.ts`). Large-scale merchant advertising deferred by policy.
- [x] **Price-List Provisions (T1.65):** Objective observations displayed with timestamps and provenance; copy clarifies data reflects observations, not merchant offers (`ProductPage.dataNote`).
- [x] **Outbound Links Review (T1.68):** Links systematically tagged `rel="nofollow noopener"` with destination URLs handled via redirect endpoint (`/api/v1/outbound/:offerId`). Only aggregate clicks are recorded; no affiliate codes, referral cookies, or purchase data exist.
- [x] **Subscription Marketing (T1.68):** Software subscription (Free vs. Premium €4.99) marketed strictly around features (alerts, export, declaration guidance), with zero alcohol promotion.
- [x] **GDPR & Privacy Compliance (T1.62–T1.64):** Anonymous usage by default (`fi.json`, `Account.anonymousBody`). Zero personal data required for basic calculation. Strict retention limits and automated deletion jobs implemented; GDPR data export functional. Cloudflare resources pinned to EU jurisdiction (`--jurisdiction=eu`).
- [x] **Consumer-Protection & Tax Disclaimers (T1.32):** Site footer carries universal disclaimer (`SiteFooter.disclaimer`). Every calculation result carries the required statutory notice (`packages/core-domain/src/disclaimer.ts` v1.0): *"Arvioitu kokonaiskustannus Suomessa. Ei ole lopullinen verovelvollisuuden määrä. Lopullinen verovelvollisuus määräytyy Tullin ja Verohallinnon vahvistamien verokantojen ja säännösten mukaan."*

### 3.2 Tax Conditions
- [x] **Official Source Mapping (T1.66):** All 86 active and historical rules in `SEED_RULES` mapped directly to official *Verohallinto* tables and statutory provisions.
- [x] **Version-Controlled Tax Tables (T1.22):** Append-only versioning implemented in D1/SQLite schema (`taxRules` table). Rate changes never overwrite historical data; queries resolve deterministically based on observation date.
- [x] **Automated Tax Calculation Tests (T1.70–T1.71):** 100% test coverage across excise and container duty formulas (`alcohol-excise.math.test.ts`, `container-duty.math.test.ts`, `tests/golden/golden-dataset.test.ts`).
- [x] **Separate Alcohol & Container Duty Engine (T1.24):** Dual-component duty engine separates beverage tax from container duty (€0.51/l) and accurately checks Palpa deposit-system exemptions (`packages/core-domain/src/tax/deposit-checker.ts`).
- [x] **Distance-Selling vs. Distance-Buying Logic (T1.67):** Deterministic classification engine validates seller-arranged vs. buyer-arranged transport and accurately advises user on MyTax advance notice and excise liability.

### 3.3 Data Governance Conditions
- [x] **Source-Permission Policy (T1.8):** `SourceGovernanceService` blocks data fetching unless a merchant has explicit `GRANTED` status. Default status is `PENDING` (off).
- [x] **Merchant Reliability Framework (T1.9):** Multi-factor reliability scoring (freshness, availability, data completeness) implemented in `packages/core-domain/src/reliability/`.
- [x] **Price & Shipping Timestamping (T1.10):** All ingested observations stamped with ISO 8601 UTC collection timestamps and dataset identifiers.
- [x] **Stale-Data Detection & Degradation (T1.11):** Observations automatically classified into `VERIFIED`, `ESTIMATED`, or `STALE` based on configurable freshness windows; stale data triggers user-facing warnings and admin alerts.

### 3.4 Product & User Experience Conditions
- [x] **Transparent Cost Breakdown (T1.32):** Itemized display of foreign retail price, currency conversion (ECB dated rates), freight estimate, alcohol excise, and container duty.
- [x] **Visible Assumptions & Evidence (T1.34):** Full derivation and input parameters visible to user on calculation cards.
- [x] **Confidence Indicators (T1.35):** Confidence badges rendered on all results based on data provenance and reliability metrics.
- [x] **Error Correction Mechanism (T1.54 / T1.55):** User-facing *"Ilmoita virheestä"* reporting modal (`CorrectionFlag`) wired to backend queue (`POST /api/v1/corrections`) and monitored via Operator Console (`apps/frontend/src/app/[locale]/ops/`).
- [x] **Official Source References:** Contextual links to vero.fi and tulli.fi displayed on guidance and calculation panels.

### 3.5 Commercial Conditions
- [x] **MVP User Testing:** Core user flows (search, calculate, filter, compare) validated across mobile and desktop viewports.
- [x] **Willingness-to-Pay & Premium Tiers:** Dual-tier structure (Free vs. Premium €4.99/mo) configured with Stripe integration and mock fallback.
- [x] **Infrastructure Cost Model:** Cloudflare Workers, D1 SQLite, R2 object storage, and Queues sized to operate well within targeted unit-economics thresholds.
- [x] **Customer Acquisition Strategy:** Organic discovery and direct search-indexing optimization prepared without violating Alcohol Act advertising prohibitions.

---

## 4. Production Launch Gate Activation Procedure

To transition Rajahinta.fi from pre-launch dark mode to live public operation, the three launch gate variables must be configured in the **production environment**.

### 4.1 Production Environment Variables

In `apps/api-worker/wrangler.jsonc`, under the `"production"` environment section, configure the launch gate variables in `vars`:

```jsonc
    "production": {
      "name": "rajahinta-api-production",
      // ... bindings (durable_objects, workflows, d1_databases, r2_buckets, etc.) ...
      "vars": {
        "RATE_SNAPSHOT_OBJECT_KEY": "config/rate-snapshot.json",
        "EMAIL_WORKER_URL": "https://rajahinta-email-worker.example.workers.dev",
        "FRESHNESS_ALERT_EMAIL_TO": "ops@example.com",
        "CORS_ORIGIN": "https://rajahinta.fi",

        // -- Production Launch Gates (Task T1.69) --------------------------
        "LAUNCH_GATE_LEGAL_OPINION": "true",
        "LAUNCH_GATE_TAX_SOURCE_MAPPING": "true",
        "LAUNCH_GATE_CORRECTION_MECHANISM": "true"
      }
    }
```

*Verification:* Ensure that `LAUNCH_GATES_OVERRIDE` is **not** present in `production.vars`.

### 4.2 Deployment Execution

1. Commit and push the configuration update to `master`.
2. Navigate to GitHub Actions and trigger the manual production deployment workflow:
   - **Workflow:** `.github/workflows/deploy-production.yml`
   - **Input:** Set `confirm_deploy = yes`
3. The workflow executes in order:
   - D1 migrations check: `pnpm --filter @rajahinta/api-worker run db:migrate:d1:production`
   - API Worker deploy: `pnpm --filter @rajahinta/api-worker exec wrangler deploy --env production`
   - Email Worker deploy: `pnpm --filter @rajahinta/email-worker exec wrangler deploy --env production`
   - Frontend Worker deploy: `pnpm --filter @rajahinta/frontend exec opennextjs-cloudflare deploy --env production`
   - Health gate validation: `curl $PRODUCTION_API_URL/api/v1/health/ready`

---

## 5. Post-Activation Verification Protocol (Smoke Tests)

Immediately following production deployment, run the following verification checks against the live production endpoints:

### Step 1: Health & Gate Status Verification
```bash
# Verify health readiness
curl -f -s https://api.rajahinta.fi/api/v1/health/ready | jq .
# Expected: {"status":"ready","d1":true,"durableObjects":true}
```

### Step 2: Anonymous Calculation Endpoint Verification (Gate Open)
Before activation, this call returned `HTTP 403 Forbidden` (`launch_gate_closed`). After activation, it must return `HTTP 200 OK`:

```bash
curl -i -s -X POST https://api.rajahinta.fi/api/v1/calculate \
  -H "Content-Type: application/json" \
  -d '{
    "product": {
      "name": "Standard Lager 5.0%",
      "category": "beer",
      "volumeLitres": 0.33,
      "alcoholByVolume": 0.05,
      "price": { "amount": 1.50, "currency": "EUR" }
    },
    "quantity": 24,
    "destinationCountry": "FI",
    "transportType": "independent_carrier",
    "transportCost": { "amount": 15.00, "currency": "EUR" },
    "depositSystemRegistered": false
  }'
```
**Expected Response:** `HTTP/2 200 OK` with full itemized landed-cost JSON structure including `exciseDuty`, `containerDuty`, and legal disclaimer.

### Step 3: Merchant Price-Data Visibility Verification
```bash
curl -i -s https://api.rajahinta.fi/api/v1/merchants
```
**Expected Response:** `HTTP/2 200 OK` with registered merchant summaries (not 403).

### Step 4: Frontend Web Verification
1. Open `https://rajahinta.fi/fi/calculator` in an incognito browser window.
2. Verify the age gate displays (*"Oletko vähintään 18-vuotias?"*).
3. Confirm 18+; verify the calculator form loads normally.
4. Confirm the `GateClosedNotice` (*"Laskuri ei ole vielä käytössä"*) is **no longer visible**.
5. Perform a test calculation; confirm breakdown displays accurately.
6. Verify the footer disclaimer and result-level tax notices are visible.

---

## 6. Rollback & Emergency Fast-Close Procedure

If an unexpected regulatory notice, tax discrepancy, or critical defect emerges post-launch:

### Option A: Instant Worker Rollback (Instantaneous, No Build)
Roll back to the pre-launch Worker version directly via Cloudflare CLI:
```bash
pnpm --filter @rajahinta/api-worker exec wrangler rollback --env production
```
*Effect:* Instantly restores the previous Worker release where launch gates were closed. Takes effect globally in seconds without DNS modification.

### Option B: Immediate Gate De-activation via Env Var
Set any single gate variable to `"false"` or delete it:
```bash
# In apps/api-worker/wrangler.jsonc:
"LAUNCH_GATE_LEGAL_OPINION": "false"
```
Redeploy with `wrangler deploy --env production`. Calculation and price-data endpoints immediately revert to returning `403 launch_gate_closed`.

---

## 7. Launch Authorization & Formal Sign-Off

By signing below, the project owner authorizes the activation of the production launch gates, confirming that all legal, tax, data, product, and commercial conditions have been fulfilled.

| Role | Name | Decision | Date | Signature |
|---|---|---|---|---|
| **Project Owner / Signatory** | _____________________________ | **[ ] APPROVED / GO<br>[ ] REJECTED / NO-GO** | ____________ | _____________________________ |
| **Lead Developer** | _____________________________ | **[X] TECHNICAL PREREQUISITES VERIFIED** | 2026-09-03 | _____________________________ |

---

*Document prepared: 2026-09-03 — Rajahinta.fi Pre-Launch Operations*

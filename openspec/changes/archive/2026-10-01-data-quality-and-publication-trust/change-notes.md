# Change notes — data quality gates and publication trust

Operator evidence log. Sections here hold **recorded facts, never
predictions**: every placeholder marked `TBD (operator)` is filled by
the operator who ran the command, with the command output as the
source. This file is never pre-filled with expected values — an
estimated count next to a real one is indistinguishable from the real
one, which is the exact failure mode this change exists to prevent.

## 2.1 Alko reference landing

**EXECUTED 2026-09-30** (20:14–23:55 UTC) — the owner provided the
Cloudflare API token (owner-directed production ops) and approved the
Alko storefront wiring; the lead ran the §6 procedure end-to-end. The
triggering prerequisite differed from §6.2's assumption: the production
`merchant_registry` had NO `alko` row at all, and the real feed is
Alko's storefront search API (`POST
https://www.alko.fi/api/search/product?lang=fi`, odata-style
pagination), which required a scoped adapter mapping change
(owner-approved deviation from decision D3 — see design.md). Registry
upsert + governance `GRANTED` insert executed per the documented
patterns; first pass 21:00 UTC (off-schedule trigger per §6.6, hourly
interval restored to daily after the pass); the first run exposed two
live-environment failures, both fixed and re-run:

1. **WAF 403** — Alko's Azure WAF challenges bare-content-type POSTs;
   the adapter now rides browser-like headers + a page delay
   (`fc133d1`).
2. **D1 API-request budget** — chunks 41+ of the initial import
   silently no-oped ("Too many API requests by single Worker
   invocation"); the workflow now crosses a durable hibernation
   boundary every 16 chunks so each group gets a fresh quota
   (`27c9f5d`).

| Metric | Value | Recorded via |
|---|---|---|
| `withReference` before | 0 (20:15 UTC) | §6.4(b) |
| `withReference` after | **444** (as_of 2026-09-30, 23:30 UTC snapshot) | §6.4(b) |
| EAN join hit-rate | **0 of 5,839 offered products (0.0%)** — the storefront source carries no EAN; qualification ran via the tier-2 compound fallback and still qualified 444 products | §6.4(c) |
| Verified at (UTC) | 2026-09-30T23:45Z | command timestamp |
| Alko reference offers before | 0 | §6.4(a) |
| Alko reference offers after | **2,861** offers / 1,425 products | §6.4(a) |

Supporting facts: producer log `enqueued 1/5` (alko due, others not);
workflow instance `price-ingestion-alko-2026-09-30-21` Completed ✅;
volume-ceiling gate fired on live rows (34 implausible volumes held for
review, e.g. "Savon Kyynel Pontikka" 40 l spirits, "Paulaner
Oktoberfest" 5 l beer); 0 zero-priced offers landed. The 0% EAN rate is
the design's named risk materialized — it feeds the dedupe/matching
follow-up (spike-notes §5.3): an EAN-bearing source (Alko's product
register) would lift the join materially.

## 2.2 Posti transcription — operator procedure

The live fetch was attempted from this session (2026-09-30) per the
admin procedure in `posti-rate.source.ts` and confirmed still blocked:

| Attempt | Result |
|---|---|
| `GET https://www.posti.fi/api/price-list/parcels.json` (this session, datacenter egress) | HTTP 403 — the documented CDN block (error 1031 class) |
| Wayback availability API for the same URL | no archived snapshots (re-confirmed) |
| posti.fi public HTML (homepage, business parcel pages) | reachable, but publishes only domestic and outbound (from-Finland) prices — **not** the inbound lane table; transcribing those rows into TO-Finland lanes would fabricate data and was not done |

The block is **egress-IP-specific** (datacenter/Cloudflare ranges), so
the operator's own browser should fetch the endpoint directly:

1. Open `https://www.posti.fi/api/price-list/parcels.json` from a
   normal (residential/mobile) connection and save the payload.
2. Deliver the JSON to the engineer/agent session (or transcribe
   directly per the admin procedure in `posti-rate.source.ts` steps
   1–3): every lane shipping TO Finland, one row per lane + package
   tier + weight bracket, VAT-inclusive EUR cents, `POSTI_OBSERVED_AT`
   bumped to the review date.
3. The transcription lands as the `POSTI_RATES` dataset rows plus the
   golden-fixture test pinning them (task 2.2's remaining deliverable);
   the monthly curated sync publishes them on the next deploy.
4. Record the fetch date + row count here and re-run the calculator
   transport check (task 5.1's fourth evidence item) — until then the
   calculator honestly renders transport as not-included.

| Metric | Value |
|---|---|
| Payload fetched at (UTC) | TBD (operator) |
| Inbound-lane rows transcribed | TBD (operator) |
| `POSTI_OBSERVED_AT` bumped to | TBD (operator) |

Task 2.2 stays open until the transcribed rows land.

### 2026-09-30 — consumer tables received, honest transcription landed

The owner supplied Posti's structured consumer price tables (domestic
parcels XXS–XXL, domestic letters, international letters + Baltic/other-EU
parcels, additional services). Transcription findings, recorded as the
review of record:

- **No TO-Finland lanes exist in the consumer tables.** Every parcel rate
  is FI→FI or FROM-Finland (FI→EE/LV/LT, FI→EU). The admin procedure's
  "rows relevant to the calculator's lanes (shipping TO Finland)" has an
  empty solution set here; inverting outbound consumer rates was
  rejected — it would fabricate both lane direction and a merchant
  contract price a consumer table cannot provide.
- **Transcribed**: the domestic Small Parcel (XXS) tier — the one row
  that maps onto `CarrierRateOffer` without invention (weight-distinct
  0–2 kg, €7.90, FI→FI, parcel). `POSTI_OBSERVED_AT` → 2026-09-30.
- **Excluded, with reasons**: S/M/L/XL/XXL domestic tiers share the
  25 kg cap and differ only in dimensions the row shape cannot carry
  (several prices in one weight bracket = first-DB-hit decides — the
  exact ambiguity the Fransberg bracket epsilon exists to prevent);
  Baltic/outbound tables price lanes this calculator never queries and
  publish no per-size weight brackets; letters, the "other EU from
  €32.90" starting price, Åland surcharge and additional services are
  not lane-bracket rates.
- **Tests**: `posti-rate.source.test.ts` now pins the transcription
  (exact row, no-fabricated-inbound-lane guard, bracket-unambiguity +
  price-floor guard, observed-at stamp).

**What would complete the picture**: the lane-shaped JSON payload
(`posti.fi/api/price-list/parcels.json` — reachable from a residential
connection, still 403 from datacenter egress) carrying true
TO-Finland bracket prices, or a dimensions-aware row schema (a separate
change). Until either lands, cross-border transport renders the honest
not-included state; the calculator's domestic lane (FI merchant → FI
consumer, e.g. kippis) gains the ≤2 kg parcel rate.

## 5.1 Local verification (2026-09-30)

Full local verification of the working tree at `cbab396`
(`feature/data-quality-and-publication-trust`), run with node
v24.21.0 / pnpm 9.15.9 (`PATH=/root/.nvm/versions/node/v24.21.0/bin`).
Everything below is recorded output; no code was changed by this pass.

### Suite results

| Suite (command) | Exit code | Count |
|---|---|---|
| `pnpm typecheck` | 0 | 8/8 workspace projects pass |
| `pnpm lint` | 0 | clean |
| `pnpm lint:content` | 0 | clean |
| `pnpm test` (unit, recursive) | **1** | 1 failed / 5371 passed / 3 skipped — details below |
| `pnpm test:golden` | 0 | 44/44 (2 files) |
| `pnpm test:d1` | 0 | 159/159 (14 files) |
| `pnpm test:e2e` | 0 | 15/15 (1 file) |

Unit totals by package — email-worker 83, core-domain 1440, api-worker
1058, frontend 1025, data-platform 695 passed + **1 failed** (696),
data-acquisition 323, application-api 728 passed + 3 skipped (731),
backend 19. `pnpm -r test` stops at the first failing package, so the
last three were run individually afterwards (`pnpm --filter … test`)
and are green; the failure is not masking anything downstream.

### Failures (recorded, not fixed — verifier pass)

1. **Unit** — `packages/data-platform`:
   `src/repositories/d1/__tests__/session.repository.test.ts >
   D1SessionRepository > deleteExpiredBefore removes only expired
   sessions and returns the count`
   → `AssertionError: expected null not to be null`
   at `session.repository.test.ts:193:5`. Reproduces in isolation
   (rerun of the single file: 1 failed / 8 passed) — deterministic,
   not flaky. This branch's diff touches no session code; the test and
   repository were last modified in `aa743c4` (migrate-to-cloudflare
   2.5).
2. **Browser** — Playwright workers suite
   (`tests/e2e-browser/playwright.workers.config.ts`): 13 passed /
   **1 failed** — `[chromium] › account-export.spec.ts:22:7 ›
   anonymous visitor: no session minted, no account data rendered`
   → `Error: expect(locator).toBeVisible() failed …
   'Tilin tietojen lataaminen epäonnistui.' element(s) not found`.
   Observed on the live stack: `GET /api/v1/account/me` unauthenticated
   answers 401 `SessionRequired` (correct), and the account page
   handles 401 by redirecting to `/login` (its designed sign-in
   surface); the journey still expects the retry-affordance message.
   Stale journey expectation on the auth surface — unrelated to this
   change's data-quality behaviors. The journey's other assertions
   (no welcome heading, no session id, no `rajahinta_session` cookie
   on the calculator path) passed.

### Live checks (workers stack, real headless Chromium)

Stack booted per the repo's own harness
(`tests/e2e-browser/boot-workers-stack.sh`): local D1 reset →
migrations → task-2.6 seed → journey fixtures → API Worker `:8788`
(health/ready 200, d1 + DOs up) → frontend Worker `:8787`
(`SKIP_BUILD=1`, `.open-next` output from the suite's build).
Locale fi (default); evidence screenshots kept outside the repo in
`/tmp/opencode/51-home-savings.png`, `/tmp/opencode/51-calculator-transport.png`.

1. **LOWEST_PRICE head has no €0.00 — PASS.**
   `GET /api/v1/products?sort=LOWEST_PRICE` (age-gated): head is
   "Pirkka Pasta" at `lowestPriceCents: 89` (€0.89); all 47 products
   sort strictly ascending 89 → 95000 c with **no zero-priced row**;
   the one unpriced product ("Sample Aperitif") sorts **last** with
   `lowestPriceCents: null` — offer-less tail, never a €0.00 figure.
2. **Calculator renders the honest transport state — PASS.**
   API (`POST /api/v1/calculator`, product 9001 TEST Beer ×6 → FI):
   itemized `transportCost | cents: 0 | reliability: UNAVAILABLE`;
   total 1770 c = 894 + 516 + 0 + 360 (transport adds nothing).
   Browser (`/calculator`, search TEST Beer, qty 6, "Laske
   kokonaiskustannus"): the transport row renders
   `transport-not-included` = "Ei sisällytetty – tietoaineisto
   odottaa" with the "Ei saatavilla" badge — **no amount on the
   line** — plus the `transport-pending-note` explanation. The only
   €0.00 anywhere in the breakdown is the container-duty line
   (different category, verified-zero); the transport line shows text,
   not a figure.
3. **Homepage savings card matches the overview — PASS.**
   `GET /api/v1/savings/overview` → `{"asOf":null,"categories":[]}`
   (with-reference sum = 0). Homepage renders
   `savings-card-pending` ("Alkon viitehintoja ei ole vielä
   yhdistetty tuotteiden kokonaishintalaskelmiin, joten luetteloa ei
   ole vielä julkaistu.") and contains **zero** `a[href="/savings"]`
   links — pending card, no CTA into the unpublished listing.
4. **Posti-backed calculation shows a real transport figure — DEFERRED.**
   Not runnable: the transport dataset is empty by design until task
   2.2's operator transcription lands (see §2.2 — live endpoint 403
   from datacenter egress, no Wayback snapshot, inbound lanes not
   published on posti.fi HTML). The honest-state rendering above is
   the designed behavior for exactly this state; the check re-runs
   after §2.2's table is filled.

### Exact commands

```bash
export PATH=/root/.nvm/versions/node/v24.21.0/bin:$PATH

pnpm typecheck; pnpm lint; pnpm lint:content
pnpm test                       # 1 failed (data-platform) → short-circuit
pnpm --filter @rajahinta/data-acquisition test
pnpm --filter @rajahinta/application-api test
pnpm --filter @rajahinta/backend test
pnpm test:golden; pnpm test:d1; pnpm test:e2e

# Browser pass — workers stack (D1), suite manages both servers:
pnpm exec playwright test -c tests/e2e-browser/playwright.workers.config.ts
# → 13 passed / 1 failed (account-export journey, see above)

# Manual live pass for the three checks:
bash tests/e2e-browser/boot-workers-stack.sh api
SKIP_BUILD=1 E2E_API_PORT=8788 E2E_FRONTEND_PORT=8787 \
  bash tests/e2e-browser/boot-workers-stack.sh frontend
curl -s -H "x-age-confirmed: 1" \
  "http://localhost:8788/api/v1/products?sort=LOWEST_PRICE"
curl -s -H "x-age-confirmed: 1" -H "content-type: application/json" \
  -X POST http://localhost:8788/api/v1/calculator \
  -d '{"productId":9001,"quantity":6,"destination":"FI"}'
curl -s -H "x-age-confirmed: 1" http://localhost:8788/api/v1/savings/overview
# + headless-Chromium driver over the real UI (age gate → calculator
# → result card; homepage card), script kept in /tmp/opencode/
bash tests/e2e-browser/boot-workers-stack.sh down
```

### Failure verdicts (lead review, 2026-09-30) — both PRE-EXISTING on master, fixed on this branch

Neither failure touches a file this change modifies (`git diff master...HEAD` over
`packages/data-platform/`, `tests/e2e-browser/`, and the account pages is empty):

1. **`session.repository.test.ts` date bomb** — the kept session's expiry was the
   hardcoded literal `2026-09-30T00:00:00Z`, which expired at 00:00 UTC on its own
   date: the test passed 2026-09-29 and failed 2026-09-30, turning master CI red
   independently of this branch. Fixed in `a4164d9`: kept-session expiry rides
   `DEFAULT_EXPIRY()` (now + 30 days); the expired-side fixtures stay fixed past
   dates, which is correct for always-expired rows.
2. **`account-export.spec.ts` stale journey** — the journey pinned the old
   harness-stack divergence ("retry affordance"), but the account page's client
   unconditionally replaces the route with `/login` on a 401 (design D8) on every
   stack, so the retry message never renders. Fixed in `9230896`: the journey
   asserts the designed redirect outcome (`/login` URL) plus the unchanged
   no-data/no-cookie pins.

Post-fix evidence (owner-approved fixes, 2026-09-30):

| Check | Result |
|---|---|
| `session.repository.test.ts` in isolation | 9/9 pass |
| `account-export` journey on the workers stack | 1 passed |
| Full `pnpm test` (all packages) | green — api-worker 1058, frontend 1025, data-platform 696, data-acquisition 323, application-api 728 (+3 skip), backend 19 |

With these two, every suite in task 5.1's list is green; the only non-green item
remains the deferred Posti-backed figure (§2.2 operator data), and 5.1's run is
otherwise the verification record for the deploy gate in 5.2.

## 5.2 Production deploy + live verification (2026-09-30)

### Auth + dispatch record

`gh auth status` in this session (2026-09-30 ~11:56 UTC) answered
`You are not logged into any GitHub hosts` (exit 1) — the gated dispatch
is therefore **owner-run**; no run id, conclusion, or duration exists
from this session.

Dispatch mechanics, read from `deploy-production.yml` before hand-off:

- Single input: `confirm_deploy` (required, default `no`) — the job's
  first step fails before checkout unless it is exactly `yes`.
- No `ref` input is declared; the job checks out and deploys whatever
  ref the dispatch selects.
- Job chain: confirmation gate → frontend build (OpenNext,
  `NEXT_PUBLIC_API_URL = vars.PRODUCTION_API_URL`) → D1 migrations
  (production, `db:migrate:d1:production`) → deploy api/email/frontend
  Workers (`--env production`) → health gate
  (`GET $PRODUCTION_API_URL/api/v1/health/ready`, 30 × 10 s) →
  rollback-runbook job. **No seed step** — production is never seeded.
- Concurrency group `deploy-production` (serialized); every
  `wrangler deploy` versions the prior Workers scripts for instant
  `wrangler rollback` (no DNS).

**Merge-first fact:** this branch's head `feb6c04` is contained in no
remote branch (`git branch -r --contains feb6c04` → empty);
`origin/master` sits at `b28a03b` (PR #71 merge, predates this change).
A dispatch on `master` before the merge would deploy master's tree —
none of this change's behaviors. The merge is outside this session's
authority (no push, no merge), so the dispatch is handed to the owner:

```bash
# 1. Gated dispatch (input name matters; run AFTER the branch merges):
gh workflow run deploy-production.yml --ref master -f confirm_deploy=yes

# 2. Record run id + conclusion + duration:
gh run list --workflow=deploy-production.yml --limit 1
gh run watch <run-id>
```

### Live evidence — the four pains (all PRE-DEPLOY, production)

API base `https://api.rajahinta.fi`; every API call carried
`x-age-confirmed: 1` (the calculator POST additionally
`content-type: application/json`). Frontend fetched server-side, no
auth. These are the CURRENT live states before any dispatch — re-run
after the deploy and label the rows POST.

| # | Pain | Endpoint / surface | Observed (UTC) | Result |
|---|---|---|---|---|
| 1 | €0.00 crowned at `LOWEST_PRICE` | `GET /api/v1/products?sort=LOWEST_PRICE` | 2026-09-30T11:56:49Z · HTTP 200 | **Still crowned.** Head rows: id 76 "R de Ruinart Champagne 12.5% 0.75 l" and id 626 "Famille Perrin Les Christins Vacqueyras Rouge 14.5% 0.75 l", both `lowestPriceCents: 0` with `eurPerGram.reason: "INVALID_PRICE"`. Next rows are €0.49 MINI bottles (ids 171, 179, 187). The price gate rejects at INGESTION, so already-stored zero-priced rows persist until that merchant's next feed sweep — a still-present €0.00 head post-deploy is the documented sweep behavior, not a deploy failure. |
| 2 | Transport figure honesty | `POST /api/v1/calculator` `{"productId":1761,"quantity":6,"destination":"FI"}` — id 1761 = "Smirnoff Vodka 37.5% 1.5 l", 2599 c/unit | 2026-09-30T11:58:08Z · HTTP 200 | **UNAVAILABLE, stated honestly.** Itemized `Transport | transportCost | cents 0 | reliability UNAVAILABLE`; total `43990 c` (€439.90 = 15594 retail + 0 transport + 18996 excise + 462 container duty + 8938 import VAT); confidence `LOW`; structural disclaimer present (fi, v1.0). Real transport figures stay deferred until §2.2's operator transcription lands — their absence is not a deploy failure. |
| 3 | Savings coverage | `GET /api/v1/savings?category=spirits` + `GET /api/v1/savings/overview` | 2026-09-30T11:56:49Z · HTTP 200 | **Zero coverage.** `category=spirits` → `coverage {evaluated: 4414, withReference: 0, listed: 0}`, `rows: []`, `asOf: null`; overview → `{asOf: null, categories: []}`. Expected until task 2.1's Alko-reference data action runs. |
| 4 | Frontend surfaces | `https://rajahinta.fi/`, `/savings`, `/calculator` | 2026-09-30T11:58:08Z–11:59:20Z · all HTTP 200 | **Pre-branch bundle live.** Homepage renders the static link card into `/savings` ("Kokonaishinta-ero Alko-viitehintaan"); no pending-state card — markers `savings-card-pending` / `taskCardsSavingsPendingBody` are absent from the served HTML. `/savings` SSRs a text skeleton (`data-variant="text"` pulse) plus the category nav (`/savings?category=spirits`); content client-fetches. `/calculator` SSRs the shell with i18n labels (`UNAVAILABLE → "Ei saatavilla"`, `transportCost → "Kuljetuskustannus"`) but the branch's `transportPending` strings are absent. The frontend deploys via the same workflow, so the pending card and honest transport note appear only POST-dispatch. |

### Post-dispatch verification (re-run, label POST)

Same commands after the owner's dispatch goes green (the workflow's own
health gate already proves `/api/v1/health/ready` before concluding):

```bash
curl -s -H "x-age-confirmed: 1" \
  "https://api.rajahinta.fi/api/v1/products?sort=LOWEST_PRICE" | head -c 600
curl -s -H "x-age-confirmed: 1" -H "content-type: application/json" \
  -X POST https://api.rajahinta.fi/api/v1/calculator \
  -d '{"productId":1761,"quantity":6,"destination":"FI"}'
curl -s -H "x-age-confirmed: 1" \
  "https://api.rajahinta.fi/api/v1/savings?category=spirits"
curl -s -H "x-age-confirmed: 1" https://api.rajahinta.fi/api/v1/savings/overview
# Frontend — pending card + transport-pending-note are this branch's additions:
curl -s https://rajahinta.fi/ | grep -c "savings-card-pending"
curl -s https://rajahinta.fi/calculator | grep -c "transportPending"
```

Expected POST states (honest, per the designed timeline): homepage
renders `savings-card-pending` (withReference stays 0 — task 2.1 data
action pending); the calculator result renders the transport-pending
note (task 2.2 transcription pending); savings coverage stays 0;
`LOWEST_PRICE` sheds its €0.00 rows only as each merchant's next feed
sweep re-ingests under the new gate — their persistence is documented
sweep behavior, not a deploy failure. Task 5.2's record completes when
the dispatch run id + conclusion are appended above.

### 22:10–23:55 UTC — deploy EXECUTED (owner-directed, pipeline mirrored locally)

The hand-off above was superseded the same evening: the owner provided
the Cloudflare API token and approved the deploy; `gh` remains
unauthenticated (the `confirm_deploy` gate's approval was given here in
session, explicitly, twice), so the pipeline's exact steps ran locally
against the merged master (`b283a03b..0313d88`, then fix commits — all
pushed):

| Step | Result |
|---|---|
| `db:migrate:d1:production` | ✅ no migrations to apply (schema unchanged) |
| api-worker deploy | ✅ `8b2aaf10` → adapter fix `9db09b13` → budget fix `737b4a0d` |
| email-worker deploy | ✅ `9bcb8c22` |
| frontend deploy (OpenNext, `NEXT_PUBLIC_API_URL=https://api.rajahinta.fi`) | ✅ `916b1f8f` → post-landing rebuild `2fafe9c8` |
| Health gate `/api/v1/health/ready` | ✅ HTTP 200 attempt 1 (D1 + DO up) |

Rollback availability unchanged: every deploy versioned the prior
script (`wrangler rollback --env production` per Worker).

### Live evidence — POST-deploy (the four pains, 23:30–23:55 UTC)

| Pain | PRE (11:56–11:59Z) | POST (23:30–23:55Z) |
|---|---|---|
| €0.00 crown on `sort=LOWEST_PRICE` | two zero-priced rows head (ids 76, 626) | rows persist (documented sweep timeline — the price gate holds for NEW ingestion; the rows clear at the merchant's next daily sweep pass) |
| Calculator transport | `0 c / UNAVAILABLE` | unchanged — `0 c / UNAVAILABLE` honest state (cross-border Posti rows still pending, §2.2; the landed FI→FI ≤2 kg row publishes on the next monthly curated sync) |
| Savings coverage | `withReference: 0`, listing empty | **`withReference: 444`** — `GET /api/v1/savings?category=spirits` lists 50 real rows with gaps (e.g. "Suomi Viina" €27.38 vs landed €45.90, 6,764 bps) |
| Homepage savings card | static link card into an empty listing | **CTA restored** — rendered-DOM verification: `pending: 0`, `a[href="/savings"]: 1`, populated-listing copy; flipped with ZERO frontend code change (the designed behavior) |

### PLATFORM FINDING (follow-up, high priority): time-based ISR never
### revalidates in production — server-fetched pages freeze at build

The homepage kept rendering the pre-landing pending state hours after
`withReference` turned non-zero. Rendered-DOM + flight-payload
inspection showed the served HTML was the 20:14 build snapshot
(no `productCount` anywhere, FAQ guides section absent), and
`open-next.config.ts` itself documents the mechanism: time-based
revalidation needs a queue; the chosen **memory queue has per-isolate
dedupe**, and on a near-zero-traffic site every request is a cold
isolate — the queued revalidation dies with it, so the R2 incremental
cache serves the build-frozen page indefinitely. Every server-fetched
surface (savings page, product price-context, sitemap guide slugs, FAQ)
is frozen at build until the next deploy. The savings landing was the
first time content changed post-build, which is why this surfaced now.

Remedies to weigh in the follow-up change: the adapter's DO queue
(rejected at migrate-to-cloudflare for preview-URL reasons — that
constraint may deserve revisiting), Cloudflare Queues, or a scheduled
cache-warming cron. Recorded here because the honest-state design
("the card flips with no frontend change") REQUIRES working ISR.

### 2026-10-01 10:15 UTC — post-archive follow-up: catalog aggregate fix + canonical pipeline deploy

Deploying the archived change exposed pain #1's residual: the /products
catalog (sort=LOWEST_PRICE) still crowned a €0.00 row. Root cause: the
catalog browse aggregate (repository `listCatalogPage`) MINned ALL
observation rows, while the search/detail paths read the latest
observation per (product, merchant) — a superseded pre-floor zero
scrape (product 76, Sep 14) dragged the catalog minimum below what the
detail page listed, violating the route's own parity principle.

- Fix: `e3b17ce` — `listCatalogPage` (sort key + rendered aggregate)
  now reads the latest observation per (product, merchant); regression
  test pins the incident shape (superseded 0 → recovered price).
- Canonical gated pipeline deploy (gh-authenticated this time):
  run 36847355283 ✅ 2m3s — api `1e876e70`, email `2af6802b`, frontend
  `74591e4c`; health gate ✅. CI on the push: CI ✅, Deploy Staging ✅,
  E2E browser ✅ (31+ checks).
- Result: product 76's crown GONE (€70.99 latest observation renders).
  ONE residual row remains (product 626, alks, €0.00 observed Sep 30):
  the feed still flaps 0 ↔ real price for it, and the gate correctly
  rejects new zero observations — so the stale row self-heals only when
  the source publishes a plausible price again (as product 76's did on
  Oct 1). An immediate removal is a one-row owner-approved deletion;
  recorded here rather than executed, because production data deletion
  is an owner decision.

# Change notes — onboard-kippis-merchant

(findings and rollout evidence accumulate here during apply)

## 1.1 — Catalog sweep findings

2026-09-15 · `scripts/kippis-catalog-sweep.ts` (cloned from the longero sweep; same sequential per_page=100 walk capped by the first usable X-WP-TotalPages, read-only GETs) · run via `pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/kippis-catalog-sweep.ts` · result: `sweep COMPLETE — 7/7 pages, 0 page failures`.

### Walk

- X-WP-Total 677 = raw rows seen 677 (no pagination drift), pages declared 7, all fetched ok.
- Records parsed 184; rows dropped 493 → 184 + 493 = 677 (full accounting).

### Drop-rate and row-drop categories

- **72.8% drop-rate today (493/677)** — every drop is `no canonical beverage category`. Zero category disagreements, zero non-EUR/invalid-price/missing-name rows.
- 512 kept-without-EAN correction errors — every row carrying a SKU (no kippis SKU matches the current `^[a-z]{2}-\d{13}$` rule).

### Per-category error distribution (drops by raw category term)

`no-canonical-beverage-category` drop lines by the row's raw term: Valkoviinit 98, punaviinit 80, Vodkat ja Viinat 28, kuohuviinit 37, Liköörit 40, Konjakit 40, Viskit 31, Virvoitusjuomat ja mikserit 29, rommit 22, Siiderit lonkerot ja seltzerit 13, Ginit 7, Energiajuomat 21, Aperitiivit 12, uncategorized 32, Lahjakortti 4, Upsell 1. The drops are spread across **all** Finnish categories — the vocabulary gap (task 1.2) is the single driver, not one bad category. Lahjakortti (gift cards, 4) and Upsell (1) are non-beverage rows that correctly keep dropping.

### SKU/EAN gap (design D2 buckets, raw rows)

165 rows (24.4%) have no/empty SKU — EAN-less by parser design regardless of 2.1 (proposal non-goal: no image-filename recovery). Of the 512 SKUs present:

| Bucket | Rows | Share of SKUs present |
|---|---|---|
| prefixed `^[a-z]{2}-\d{13}$` (accepted today) | 0 | 0.0% |
| bare 13-digit `^\d{13}$` | 438 | 85.5% |
| GTIN-14 `^0\d{13}$` | 21 | 4.1% |
| other (stays EAN-less) | 53 | 10.4% |

- "other" holds 16 twelve-digit numerics plus internal codes (`1038480`) and suffixed EAN variants (`4740019769500/3`) — D2's no-guessing rule (no UPC-A zero-padding, no suffix stripping) keeps them in the correction queue.
- D2 shapes cover **459/512 SKUs (89.6% of present, 67.8% of all rows)** — that 67.8% is the ceiling for tier-1 EAN matching into `product_master` (design D4).
- Probe deltas: probe said 82% bare-13 / 7% GTIN-14; full catalog measures 85.5% / 4.1% of present SKUs. Total 677 confirmed.

### Multipack case pricing (`33cl x 24`)

- 103 rows (15.2%) carry a structured volume/count case name (`33cl x 24`, `24x33cl`); 115 (17.0%) any loose `x N` token.
- Of the 184 parsed records, 41 are multipack with count+volume. Median implied €/l at kept (per-container) volume: **singles 35.64 vs multipack 93.91 (2.6× skew)**; case-adjusted (÷ pack count) **4.04 €/l** — in line with singles once divided by the pack count. 35/41 multipack records imply >2× the singles median. **`prices.price` is the case price** for these rows, as the design's accepted-risk predicted.
- Sample: `Hartwall Original Long Drink Light Strawberry 4,5% 33cl x 24 tölkkiä` — 30.99 EUR → 93.91 €/l at kept volume → 3.91 €/l if case price.
- Side observation (no scope change): compact forms `33clx24` / `0,33Lx12` defeat the parser's volume regex (unit not token-final) — they drive most of the 7 ESTIMATED records (3.8% of records, 1.0% of raw rows). Data-quality-pass input.

### Finnish category-vocabulary coverage (design D3 candidates)

**All 13 candidate terms appear verbatim as exact raw category terms** — substring and exact counts are identical (no inflected/compound variants beyond the listed group terms). `mapSourceCategory` lowercases+trims before its exact lookup, so the raw terms' inconsistent casing (`Valkoviinit`, `punaviinit`, `Vodkat ja Viinat`) hits lowercase additive keys unchanged:

| Candidate term | Rows | % of raw rows |
|---|---|---|
| valkoviinit | 100 | 14.8% |
| punaviinit | 82 | 12.1% |
| vodkat ja viinat | 74 | 10.9% |
| siiderit lonkerot ja seltzerit | 60 | 8.9% |
| kuohuviinit | 54 | 8.0% |
| liköörit | 47 | 6.9% |
| konjakit | 45 | 6.6% |
| ginit | 37 | 5.5% |
| viskit | 37 | 5.5% |
| rommit | 35 | 5.2% |
| virvoitusjuomat ja mikserit | 29 | 4.3% |
| energiajuomat | 21 | 3.1% |
| aperitiivit | 15 | 2.2% |

Full raw census is 15 distinct terms — the 13 candidates plus `Upsell` (4 rows) and `Lahjakortti` (4 rows); neither gets a key.

### Verdicts

- **Task 1.2: GO** — every one of the 13 candidate Finnish terms appears as an exact live category term and the 72.8% drop-rate is driven by exactly these rows, so the additive keys land as listed (no trimming for absence; no extension beyond the list is indicated).
- **Task 2.1: GO** — bare-13 + GTIN-14 acceptance covers 89.6% of the non-prefixed SKUs (all 512 are non-prefixed), and the 10.4% residual is precisely the shapes D2 rejects (16 twelve-digit rows do not justify UPC-A zero-padding); the 165 no-SKU rows stay EAN-less per the proposal's non-goal.

Verification: script typechecked (`tsc --noEmit` with the repo's base compiler flags — no config changes) and eslint-clean before the run.

## 3.1 — Local rollout

**Date**: 2026-09-15. All steps LOCAL (`wrangler dev` on port 8788 — 8787 occupied by an unrelated local service; `wrangler d1 execute DB --local`); live **read-only GETs** to www.kippis.net (and longero.fi for its own due message); zero staging/production contact. `@rajahinta/core-domain` rebuilt first (`pnpm --filter @rajahinta/core-domain build` — the 2.1 stale-`dist` lesson; nothing else rebuilt: the worker bundles data-acquisition/data-platform from source via relative imports, verified in `apps/api-worker/src/queues/pipeline.ts`).

**Local D1 state found (read-only probes before any write)**: registry = alko (empty feed URL) + alks (**hourly** 3,600,000 locally — untouched, same as longero 3.1 found) + longero (daily 86,400,000, from longero's 3.1); `source_governance` = exactly 1 row (longero GRANTED); `retail_offers` = 986 longero + 48 seed/test rows (1,034 total), zero kippis; `product_master` = 974 rows. Schema note: the offers table's merchant column is `merchant` (text), NOT `merchant_id` — verification queries must match on it.

### Step 2 — registry + governance inserts (idempotent, no existing row touched)

- `INSERT INTO merchant_registry (merchant_id, name, country, feed_url, feed_format, polling_interval_ms) VALUES ('kippis','Kippis','FI','https://www.kippis.net','json',86400000) ON CONFLICT (merchant_id) DO NOTHING` — unique index makes re-runs no-ops. Read-back: row **id 4**, values exactly per task spec, timestamps 07:22:17.603Z.
- `INSERT INTO source_governance (…) SELECT 'kippis','RETAILER_API','GRANTED','https://www.kippis.net/wp-json/wc/store/v1/products','<reason>',strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE NOT EXISTS (…)` — the table has no unique key, so the `NOT EXISTS` guard is the idempotency mechanism (longero 3.1 pattern). `status_reason`: "onboard-kippis-merchant task 3.1: owner blanket-permission policy — documented scraping right (longero precedent); local GRANT for first-ingest verification" (D5). Read-back: row **id 2**, all fields exact.
- alko/alks/longero registry rows and longero's governance id 1 untouched (id/timestamps identical before/after).

### Step 3 — producer tick + ingestion workflow end-to-end

1. **Real-clock tick**: `wrangler dev --port 8788` + `curl "http://localhost:8788/cdn-cgi/handler/scheduled?cron=0+*+*+*+*"` → `enqueued 0/4 registry merchant message(s) … (2 not due this tick)`. alko no-URL skip + alks fail-closed skip unchanged; the "2 not due" = longero **and kippis** — kippis was recognized as permitted by the governance gate and correctly deferred by the daily interval-bucket gate at 07:2x UTC.
2. **Due-tick**: temporary vitest harness (longero 3.1 pattern; deleted after the run) running the unmodified `schedulePriceIngestions` against real local bindings via `wrangler.getPlatformProxy` over the same `.wrangler/state`, with `now` = the next boundary pass (2026-09-16T00:30Z), and a send-spy wrapping the real queue binding. Result: `{"merchants":4,"enqueued":2,"skippedNoFeedUrl":1,"skippedNotPermitted":1,"skippedNotDue":0,"enqueueErrors":0}` — **exactly one kippis message**: `{"dedupeKey":"price-ingestion-kippis-2026-09-16-00","merchantId":"kippis","sourceUrl":"https://www.kippis.net"}`. Longero's own daily message (`price-ingestion-longero-2026-09-16-00`) was equally due — unlike longero's 1/3 run, kippis's grant makes **two** daily GRANTED merchants fire per boundary.
3. **Consumer handoff → workflow**: the running `wrangler dev`'s queue consumer **delivered both messages itself** (dev logs: `Ingesting prices for merchant kippis (dedupe key price-ingestion-kippis-2026-09-16-00)`, then `Handed off ingestion … to Workflow instance …` for both keys) — no manual handoff was needed. A belt-and-braces manual `POST /cdn-cgi/local/explorer/api/workflows/rajahinta-price-ingestion-dev/instances` (same id + params) was also issued; it returned success without creating a duplicate — `ensureWorkflowInstance` idempotency held (instance list shows exactly one instance per key, total_count 3 including longero's 2026-09-15-00).
4. **Side effect (recorded)**: longero's re-ingest ran to completion on its own due message (idempotent; +986 new longero offer rows at a fresh `observed_at` — offer rows are per-observation, so a re-run adds rather than updates; pre-existing longero rows untouched).

**Workflow result**: instance `price-ingestion-kippis-2026-09-16-00` **`complete`** (07:24:42.168Z → 07:25:02.280Z, ≈20 s), `productsIngested: 636`. Error list (94): **53 kept-EAN-less SKU errors** — exactly the sweep's 53 "other" bucket (12-digit numerics, internal codes, suffixed `…/3` variants; D2 no-guessing) — plus **41 map drops** = 36 `no canonical beverage category` + 5 name/category contradiction drops. Reconciliation: 677 raw − 41 = **636** ✓. The 41 drops (6.1%) vs the sweep's 493 (72.8%) is the 13 category keys doing their job; residual drops are `uncategorized`/non-beverage/name-token gaps (correction queue, non-goal). Error labels carry the parser's own `alks product …` prefix — the shared parser is reused unchanged (same as the sweep and longero noted).

### Step 4 — verification

- **`retail_offers`**: **636 kippis rows over 635 distinct products**, min 177 / max 279,000 cents (the max is a `24 x 33cl` multipack case price — the sweep's accepted risk), all EUR / FI / `in_stock` / `ESTIMATED`, single `observed_at` 2026-09-15T07:24:49Z (= fetch step).
- **D4 EAN matching**: **39 of 636 kippis products joined pre-existing `product_master` rows, all 39 via populated `ean` (tier-1 evidence at the DB level)**; 596 products were created by this run (410 of them with EAN); `product_master` 974 → 1,570 (+596, exact). Reporting honestly against the sweep prediction: the 67.8% figure was the **EAN-supply ceiling** (share of rows carrying a usable EAN: 449 of 636 products carry one here), not an overlap prediction — the actual direct-join share into the *existing* local master is **39/449 EAN-ful = 8.7% (39/636 = 6.1% overall)**, because the pre-kippis local master population (alko seed + longero's EE catalog) barely overlaps kippis's FI catalog. The tier-1 join itself demonstrably works: e.g. `Absolut Vodka 40 % 1 l` (EAN 7312040017034) → pre-existing product 9028.
- **API** (local worker, age gate verified both ways):
  - Without `x-age-confirmed`: `403 AGE_GATE_REQUIRED` ✅.
  - `GET /api/v1/products/9028` with the header: kippis offer — `merchant: "kippis"`, `country: "FI"`, `priceCents: 2799`, `availability: in_stock`, `sourceUrl: https://www.kippis.net/product/viinat-netista/absolut-vodka-40-1l/`, `reliabilityStatus: ESTIMATED`, `observedAt: 2026-09-15T07:24:49Z` — served **alongside longero's EE offer (2499) on the same EAN-joined product**: the cross-border pair the index exists for. ✅
  - Ranked `q` search serves kippis-created products (`q=lonkero` → 14 results, first hit a kippis-created 24-can bundle). Browse-path aggregates verified present (`merchantCount`, `lowestPriceCents`).

### Commands executed (names)

`pnpm --filter @rajahinta/core-domain build` · `wrangler d1 execute DB --local` (pre-check probes → seed file → read-backs → verification queries, all in apps/api-worker) · `wrangler dev --port 8788` · `curl /cdn-cgi/handler/scheduled?cron=0+*+*+*+*` (real-clock tick) · `pnpm exec vitest run src/queues/__tests__/kippis-due-tick.harness.test.ts` (temporary due-tick harness, deleted after) · `curl POST/GET /cdn-cgi/local/explorer/api/workflows/rajahinta-price-ingestion-dev/instances…` · `curl /api/v1/products/9028` (± age-gate header) · `curl "/api/v1/products?q=lonkero"`.

### Deviations / notes vs the longero 3.1 playbook

1. **Two daily merchants due per boundary** (longero's was 1/3; kippis's own grant adds the second) — the "exactly one kippis enqueue" expectation holds; longero's message is separate and its re-run was benign/idempotent.
2. **The consumer handoff executed for real** — longero had to hand off manually because the harness's queue send could not reach the consumer; here the dev worker's queue delivery picked both messages up (harness and `wrangler dev` share `.wrangler/state` concurrently, no contention). The manual Local Explorer POST was redundant-but-harmless (idempotency held).
3. `retail_offers` merchant column is `merchant`, not `merchant_id`.
4. Follow-up observation for the lead: offer rows are per-observation (a re-run adds rows at a new `observed_at` — longero went 986 → 1,972 after its due re-run); data-quality/freshness consumers should expect per-observation growth, consistent with the time-series design.

**Environment cleanup**: temporary harness file deleted; `/tmp` seed + probe JSON removed; `wrangler dev` stopped. No tracked file changed except this notes section (the pre-existing uncommitted `tasks.md` 2.2 checkbox tick was left exactly as found).

## 4.2 — Staging rollout

Executed 2026-09-15, 09:06–09:18 UTC. Staging D1 writes explicitly approved by the task. Worker context: the live staging api-worker is from the 4.1 merge — master `6d4f3c8`, Deploy Staging run **34949960871 GREEN**. **PR #62 context**: the seed-gate fix (staging deploy verifies the merchant registry by *seeded-row presence*, not row count) is why the deploy went green and why these operator-added rows will not break future staging deploys. Nothing committed; only `notes.md` touched in the repo (the pre-existing uncommitted `tasks.md` 4.1 tick left exactly as found).

### Path decision (same blocker as longero 4.2)

The established ops path (`POST /ops/console/merchants` register+auto-grant per `docs/ingestion-runbook.md` §2.0) needs the staging `OPS_BEARER_TOKEN` Cloudflare secret — not present in any local env file (checked; values never printed). **Fell back to direct staging D1 via `wrangler d1 execute DB --remote --env staging`** (sanctioned by the task text), i.e. the same `audit_events` deviation as longero 4.2: these two inserts have no audit entry; the console is the audited route — production 5.2 must use it or record the gap.

### Pre-checks (read-only, before any write)

- `merchant_registry`: exactly 3 rows — alko (id 1, empty feed URL, hourly), alks (id 2, DE, daily), longero (id 3, EE, daily). No kippis anywhere.
- `source_governance`: exactly 2 rows — id 1 alks **`REVOKED`** ("Paused by operator 2026-09-14 — staging scraping halt; production unaffected", `updated_at` 2026-09-14T12:09:17.113Z), id 2 longero `GRANTED`. **STOP-condition clear.**
- `retail_offers` for kippis: 0. Per-merchant baseline: alks 67,600 · longero 2,221/927 products · 5 seed/test merchants 8–10 each.
- `product_master`: **3,255 rows, max id 3255** (2,824 with EAN) — the pre-ingest baseline for the EAN-match share (new products created by the ingest get ids > 3255).

### Writes (idempotent; verified by read-back)

- Registry (unique index makes re-runs no-ops): `INSERT INTO merchant_registry (merchant_id, name, country, feed_url, feed_format, polling_interval_ms) VALUES ('kippis','Kippis','FI','https://www.kippis.net','json',86400000) ON CONFLICT (merchant_id) DO NOTHING` — `changes: 1`, row read back exactly per task/design D5 spec (**id 4**, created/updated 2026-09-15T09:07:07.459Z). alko/alks/longero rows byte-identical before/after.
- Governance (no unique key — `NOT EXISTS` guard is the idempotency mechanism, longero 3.1/4.2 pattern): `INSERT INTO source_governance (merchant_id, acquisition_method, permission_status, source_url, status_reason, last_verified_at) SELECT 'kippis','RETAILER_API','GRANTED','https://www.kippis.net/wp-json/wc/store/v1/products','onboard-kippis-merchant task 4.2: owner blanket-permission policy — documented scraping right (longero precedent); staging grant for first-ingest verification',strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE NOT EXISTS (…)` — `changes: 1`, row **id 3**, all fields exact (D5 reason). **alks id 1 byte-identical before and after (still `REVOKED`, same `updated_at`).**

### First ingest via the Workflows REST API (longero 4.2 method)

- Auth: wrangler's own stored OAuth token written to a **0600 temp header file** under `/tmp/opencode` (never printed, `unset` after use, **deleted** after the run); account id captured from `wrangler whoami` into a shell variable, never emitted.
- `POST /accounts/{account}/workflows/rajahinta-price-ingestion-staging/instances` body `{"id":"price-ingestion-kippis-2026-09-15-09","params":{"merchantId":"kippis","sourceUrl":"https://www.kippis.net","dedupeKey":"price-ingestion-kippis-2026-09-15-09"}}` → `{"success":true,…,"result":{"id":"39f08a61-b9b1-41bd-812e-f10adeb422ec",…,"status":"queued"}}` at 09:08:34Z (collection form with `id` in the body, per the longero 4.2 contract note; the key pattern `price-ingestion-<merchant>-<date>-<hour>` cannot collide with the real producer, whose daily kippis key only exists at the 00:00 UTC boundary → `price-ingestion-kippis-2026-09-16-00`).
- Tooling hiccup (no side effect): the first POST went out with an empty `{account}` path segment (shell variable set in a prior tool invocation did not persist) → CF error `7003 Could not route`; re-issued with the id captured in the same invocation and succeeded. The failed request never reached a workflow route.
- Instance `price-ingestion-kippis-2026-09-15-09` (internal uuid `39f08a61-b9b1-41bd-812e-f10adeb422ec`), trigger `{source: 'api'}`. Polled via `GET …/instances/{uuid}` (the custom-id path form still 404s, per the longero 4.2 tooling note): `running` 09:09–09:15, **`complete` at 09:15:28Z (≈6.7 min)**.

### Workflow result — all 9 steps first-attempt success

resolve-merchant → governance-gate (GRANTED honored) → fetch-feed (live www.kippis.net, 6.3 s, read-only GETs) → map-records → upsert-offers-1/2/3 (~2.2 min each, staging D1 latency) → data-quality → complete-job-claim. Output: **`productsIngested: 636`**, error list 94 unique lines (zero duplicates): **36 `no canonical beverage category` + 5 name/category contradiction drops = 41 map drops**, plus **53 kept-EAN-less SKU errors** — exactly the local 3.1 shape and the sweep's 53-row "other" bucket (12-digit numerics, internal codes, suffixed `…/3`; D2 no-guessing). Reconciliation: 677 raw − 41 = **636** ✓. **Deviation from the longero playbook (a good one): no `complete-job-claim` subrequest incident** — the instance never parked in `waiting` and no step retried (kippis 636 products < longero 985; the budget risk longero 4.2/5.2 hit did not materialize at this scale).

### Verification

- **`retail_offers`**: **636 kippis rows over 635 distinct products**, min 177 / max 279,000 cents (the max is a `24 x 33cl` multipack case price — sweep's accepted risk), single value sets EUR / FI / `in_stock` / `ESTIMATED`, single `observed_at` 2026-09-15T09:08:53.532Z (= fetch step). No other merchant changed (post-run per-merchant counts identical to baseline).
- **`product_master`**: 3,255 → **3,779 (+524 products created by this run**, exact).
- **EAN matching into the EXISTING staging catalog: 111 of 636 kippis offers (17.5%) sit on pre-existing `product_master` rows (id ≤ 3255)** — **all 111 on EAN-populated rows, zero on EAN-less rows**, i.e. tier-1 EAN matching is the demonstrated join mechanism. Reporting honestly per task: staging's join share is ~3× the local run's (39/636 = 6.1%) because staging's existing master carries longero's full EE catalog (927 products) and alks's DE catalog (2,799 products) versus local's seed+longero-only master — the predicted direction, the actual number is 111. Example joins: `Suomi viina PET 32% 0.5L` (6420614689707) → product 1215, `Koskenkorva Liqueur Passionfruit` (6412700335414) → product 2228.
- **API** (`https://rajahinta-api-staging.siim-liimand.workers.dev`, product **1214** `Tapio PET 39% 0.5L`, EAN 6420614681008 — chosen because it EAN-joined a pre-existing product with a live longero offer):
  - Negative control: `GET /api/v1/products/1214` without header → **HTTP 403 `AGE_GATE_REQUIRED`** ✅.
  - With `x-age-confirmed: confirmed` → HTTP 200 with a **three-way cross-border offer set**: `alks` DE 529¢ · `longero` EE 599¢ · **`kippis` FI 990¢** — all EUR / `in_stock` / `ESTIMATED`; kippis `sourceUrl: https://www.kippis.net/product/viinat-netista/tapio-pet-39-0-5l/`, `observedAt: 2026-09-15T09:08:53.532Z` (= fetch step) ✅. Merchant aggregate block: **`kippis` offerCount 635, all ESTIMATED, freshestObservedAt = fetch step** ✅.
  - Observation for the lead (out of scope): the same aggregate block reports kippis `governancePermissionStatus: "PENDING"` while the `source_governance` row is `GRANTED` (read back directly; the workflow gate honored it). Read-model artifact, not investigated further.

### Post-checks

- `source_governance` final: 3 rows — alks **`REVOKED` unchanged** (`updated_at` still 2026-09-14T12:09:17.113Z), longero `GRANTED` unchanged, kippis `GRANTED` (new id 3). **Kippis did not un-pause staging alks.**
- Registry final: 4 rows, only kippis added. Production untouched throughout; no redeploys.

### Commands executed (names)

`npx wrangler d1 execute DB --remote --env staging --json --command "<read-only pre-check probes>"` (registry · governance · per-merchant offer counts · product_master count/max-id/EAN count · kippis offers) · same with the two `INSERT` statements · same for read-backs and post-checks · `npx wrangler whoami` (token refresh; account id into shell var) · `curl -X POST /accounts/{account}/workflows/rajahinta-price-ingestion-staging/instances` (auth: 0600 temp header file from wrangler's stored OAuth token — value never printed, file deleted after) · `curl …/instances/39f08a61-b9b1-41bd-812e-f10adeb422ec` (status poll loop, 30 s interval) · `curl /api/v1/products/1214` ± `x-age-confirmed: confirmed`.

### Deviations / notes vs the longero 4.2 playbook

1. Same ops-path blocker and same sanctioned fallback (direct D1; `OPS_BEARER_TOKEN` absent locally) → same `audit_events` deviation for the lead.
2. No `waiting` park / no step retries — kippis's catalog stayed under the invocation subrequest budget (longero's recurring incident shape absent).
3. EAN-match share 111/636 (17.5%) vs local 39/636 (6.1%) — richer pre-existing staging catalog (alks DE + longero EE), all joins tier-1 EAN.
4. Read-model `governancePermissionStatus: PENDING` in the merchant aggregate despite the `GRANTED` D1 row — observation recorded, not a blocker.
5. First REST POST mis-routed on an empty account-id path segment (variable not persisted across invocations) and was re-issued; zero side effects.

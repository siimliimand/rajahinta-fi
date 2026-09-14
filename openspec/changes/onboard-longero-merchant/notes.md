# Change notes — onboard-longero-merchant

## Task 1.1 sweep findings

- **Date / method**: 2026-09-14, `scripts/longero-catalog-sweep.ts` (cloned from the alks sweep: sequential pages, `per_page=100`, first usable `X-WP-TotalPages` caps the walk, per-page/per-row errors collected never thrown, read-only GETs). Every raw row pushed through `parseAlksStoreProducts` unchanged.
- **Run**: `pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/longero-catalog-sweep.ts`
- **Verdict**: `sweep COMPLETE` — 0 page failures, raw rows > 0.

### Key numbers

| Metric | Value |
|---|---|
| X-WP-Total (page 1) | 994 (matches the proposal's expectation) |
| Pages fetched ok | 10/10, page failures 0 |
| Raw rows seen | 994 (= X-WP-Total, no pagination drift) |
| Records parsed | 985 (99.1%) |
| Rows dropped (all causes) | 9 (**0.9% drop-rate**) |
| ESTIMATED share (ABV null or volume 0) | 5 records (0.5%) |

Payload compatibility confirmed field-for-field: EAN-shaped SKUs (`de-…`), EUR minor-unit prices, name-embedded ABV/volume, `X-WP-TotalPages`/`X-WP-Total` headers, `is_in_stock`. No non-EUR price rows, no invalid price rows, no missing-name rows.

### Per-category error distribution

| Category | Count | Share of raw rows | Effect |
|---|---|---|---|
| category disagreement (name vs categories) | 2 | 0.2% | DROP |
| no canonical beverage category | 7 | 0.7% | DROP |
| non-EUR price | 0 | 0.0% | — |
| invalid minor-unit price | 0 | 0.0% | — |
| missing product name | 0 | 0.0% | — |
| non-matching SKU (record kept, no EAN) | 349 | 35.1% | KEPT, correction queue |

Every parse error matched a known category (no unclassified errors). Samples in dropped errors carry the parser's own `alks product …` label — expected, the parser is reused unchanged.

### SKU/EAN gap

- Rows with a SKU: 936; rows with no/empty SKU: 58 (5.8%).
- SKUs matching `^[a-z]{2}-\d{13}$`: **587 — 62.7% of SKUs present, 59.1% of all rows**.
- SKUs not matching: **349 (37.3% of SKUs present)** — worse than the ~32% the 100-row probe suggested, but same shape: `V2-…` internal codes (`V2-020620231`, `V2-26042024-1`), 12-digit EANs (`de-82896001453`), and bare `V2`. By design these records are kept EAN-less and correction-queued — no remediation in this change (non-goal).

### Finnish category-vocabulary coverage (raw category terms, case-insensitive substring)

| Candidate term | Rows | Share of raw rows | Already maps in `mapSourceCategory`? |
|---|---|---|---|
| Väkevä | 475 | 47.8% | yes → spirits |
| Kuohuviini | 46 | 4.6% | yes → sparkling-wine |
| Long drink | 35 | 3.5% | yes → long-drink (other_fermented) |
| Roseeviini | 37 | 3.7% | **no — NULL** |
| Juomasekoitus | 16 | 1.6% | yes → long-drink |
| Muut juomat | 9 | 0.9% | yes → other (explicit-other token) |
| Glögg | 2 | 0.2% | yes → fortified-wine |

Rows carrying at least one candidate term: 616 (62.0% of raw rows).

### Disposition of the 9 category-driven drops (read-only probe of the dropped rows)

- **id 1914** `Roseeviini` — "The Wanted Zin Zinfandel Rosé" — the only drop the candidate list fixes: adding `roseeviini` → wine recovers it.
- **id 1196, 1227** `Alkoholiton olut` — unmapped term **not in the candidate list**; would need `alkoholiton olut` → non-alcoholic (out of 1.2's stated scope; flagged for the lead).
- **id 1858, 1766, 1854, 1874** — empty `categories: []`; name-token gaps (Soave, Jaloviina, Merlot, bare "White" BIB boxes), not vocabulary-driven.
- **id 4281** (`Väkevä`/`Viski` + "Sherry Cask" whisky) and **id 1903** (`Long drink` + "VODKA-LIME") — name-token false positives vs correct category mapping; correction queue is the right outcome.

Country terms `Germany` / `USA` / `Italy` verified to return null from `mapSourceCategory` today — the 1.2 test guard already holds.

### Go/no-go for task 1.2

**GO** — the gate condition is met: the sweep shows real category-driven drops (9 rows, 0.9%), and at least one (id 1914, `Roseeviini`) is directly recoverable by the exact candidate list. **But scope 1.2 accordingly**: six of the seven candidates already map, so the effective extension is `roseeviini` → wine (consider the plural `roseeviinit` too — the mapper is exact-match); adding the other six as explicit keys is a no-op documentation choice, not a behavior change. The lead may also want to rule on `alkoholiton olut` → non-alcoholic (2 further drops), which is outside the listed candidates.

## Lead rulings (apply stage)

- Task 1.2 scope: `roseeviini`/`roseeviinit` → wine only (the six other probe candidates already mapped). `Alkoholiton olut` (2 drops) is outside the annotated candidate list — recorded as a follow-up; needs an owner decision before mapping (non-alcoholic → `non-alcoholic`/other_fermented is plausible but not plan-sanctioned).
- Task 2.2 touches drift: annotation says `packages/data-acquisition/src/pipeline.ts`, which does not exist; the data-acquisition-side composition site is `apps/api-worker/src/queues/pipeline.ts` (`composeIngestionPipeline`). Applied there.
- Note for 6.1: rebuild `@rajahinta/core-domain` before the full test sweep or stale `dist` causes false mapper failures (hit during 2.1 verification).

## Task 3.1 local rollout

**Date**: 2026-09-14. All steps LOCAL (`wrangler dev` on port 8788 — 8787 is occupied by an unrelated local service; `wrangler d1 execute DB --local`); live **read-only GETs** to longero.fi; zero staging/production contact.

**Local D1 state found (read-only probes before any write)**: migrations `0000`–`0021` applied; `merchant_registry` = alko + alks (alks **hourly** 3,600,000 ms locally — the daily-cadence operator command from `daily-scrape-cadence-current-offers` was never run here); `source_governance` **empty** (everything fail-closed PENDING); `retail_offers` had seed/test rows only, none for alks or longero.

### Step 2 — registry + governance inserts (idempotent, no existing row touched)

- `INSERT INTO merchant_registry (...) VALUES ('longero','Longero','EE','https://longero.fi','json',86400000) ON CONFLICT (merchant_id) DO NOTHING` — unique index makes re-runs no-ops.
- `INSERT INTO source_governance (...) SELECT 'longero','RETAILER_API','GRANTED','https://longero.fi/wp-json/wc/store/v1/products', strftime(...) WHERE NOT EXISTS (SELECT 1 FROM source_governance WHERE merchant_id='longero' AND acquisition_method='RETAILER_API' AND permission_status='GRANTED' AND source_url=...)` — the table has no unique key, so the `NOT EXISTS` guard is the idempotency mechanism.
- Verified after: registry row exactly as specified (task values), governance row id 1 = the table's first row ever locally. alks untouched: still hourly, still no governance records, still zero offers.

### Step 3 — producer tick + ingestion workflow end-to-end

1. **Real-clock tick** (`wrangler dev` + `curl "http://localhost:8788/cdn-cgi/handler/scheduled?cron=0+*+*+*+*"`; `/__scheduled` is gone in wrangler 4.127): producer logged `Skipping merchant "alko": registry feed URL is empty`, `Not scheduling merchant "alks": no governance records — defaulting to PENDING`, `enqueued 0/3 … (1 not due this tick)`. longero was **recognized as permitted** (the governance grant works) and **correctly deferred** by the interval-bucket gate: the daily 86,400,000 ms bucket only crosses on the 00:00 UTC pass.
2. **Due-tick**: ran the unmodified `schedulePriceIngestions` against the real local bindings with `now` = the next pass's clock (2026-09-15T00:30Z, inside the daily window) — via a temporary vitest harness (deleted after) calling `wrangler.getPlatformProxy` over the same `.wrangler/state`. Result: `enqueued 1/3 … (0 not due this tick)`, dedupe key `price-ingestion-longero-2026-09-15-00`; alko no-URL skip + alks fail-closed skip unchanged. The queue `send` itself executed, but `getPlatformProxy` is a documented no-go for Workflows/DOs locally (bindings absent), so the consumer could not process the message there.
3. **Consumer handoff → workflow**: performed the consumer's exact handoff (`ensureWorkflowInstance` = `workflow.create({ id: dedupeKey, params })`) on the live `wrangler dev` worker through wrangler 4.127's Local Explorer API: `POST /cdn-cgi/local/explorer/api/workflows/rajahinta-price-ingestion-dev/instances` with the same id + params. The **only** hop not exercised for real is the Queue delivery + IdempotencyDO job claim (local queue state is in-memory; getPlatformProxy can't wire DOs); every downstream stage ran unmodified in workerd: resolve → governance gate (read the local D1 GRANTED row) → live fetch (10 pages, read-only GETs) → map → upsert → quality → complete.

**Workflow result**: instance `price-ingestion-longero-2026-09-15-00` `complete` (13:36:31→13:36:59Z), `productsIngested: 986`. The error list is exactly the task 1.1 sweep's known correction-queue buckets — non-EAN SKUs (`V1-`/`V2-`, 12-digit, date-like) kept EAN-less, and the same category-drop ids the notes already dispositioned (1196, 1227, 1766, 1854, 1874…). No new error categories.

### Step 4 — verification

- **`retail_offers`**: **986 longero rows** over **927 distinct products**, all EUR minor-unit, `in_stock`, reliability `ESTIMATED` (the ingest default for foreign retail offers — seed fixtures are `VERIFIED`; the data-quality pass reclassifies on its own cadence). Instance output reconciles with the sweep (985 parsed then; live catalog +1).
- **API** (local worker, age gate verified both ways):
  - Without `x-age-confirmed`: `403 AGE_GATE_REQUIRED`.
  - `GET /api/v1/products/9067` with the header: longero offer — `merchant: "longero"`, `country: "EE"`, `priceCents: 999`, `availability: in_stock`, `sourceUrl: https://longero.fi/tuote/…`, provenance (`observedAt`, `reliabilityStatus`) and the €/g metric.
  - Browse path (no `q`): longero products carry real aggregates (`merchantCount: 1`, `lowestPriceCents` 499–1349 range observed).
  - Ranked `q` search returns longero products with the base shape (`merchantCount: 0` there is the endpoint's design — offer aggregates only apply to browse/detail paths).

**Follow-up notes for the lead**:
- Tonight's real 00:00 UTC pass will generate the same dedupe key (`price-ingestion-longero-2026-09-15-00`); the consumer will find the instance complete and skip (designed idempotency). The next real local ingest is 2026-09-16 00:00 UTC.
- The local alks row is still hourly (3,600,000) — out of scope here (no existing row may be modified), but it means a locally GRANTED alks would fire every tick; the fail-closed governance gate is the only thing keeping it off locally.
- Environment cleanup: temporary vitest harness file and the `@rajahinta/core-domain` node_modules symlink used by the harness were removed; nothing in tracked files changed except this notes section.

## Task 4.1 merge + staging deploy

Executed 2026-09-14, with explicit user approval for merge+push.

1. Pre-check: working tree clean on `feature/onboard-longero-merchant`; 7 commits ahead of local `master` (`ad015ea`) — the 6 work commits plus the change-plan doc commit `2e29dff`. Merge-base = `ad015ea`, so ff was possible.
2. `git checkout master && git merge --ff-only feature/onboard-longero-merchant` — **fast-forward `ad015ea..9d075b8` succeeded** (16 files, +1374/−4; no merge commit needed).
3. `git push origin master` — **pushed `ad015ea..9d075b8`**. Remote reported: `Bypassed rule violations for refs/heads/master: Required status check "CI / ci-pass" is expected.` — direct push bypasses the branch-protection gate by permission; CI was still watched to green below.
4. CI on `9d075b8` (push triggered three workflows):
   - **CI** run `34872382039` — ✅ success, all 14 jobs green (Lint, Worker checks, D1 suite, Wrangler config validation, Build, Content policy, Golden-dataset, Unit tests, Compliance, E2E tests, Integration, Composition smoke, Data-quality, `CI / ci-pass`). Only pre-existing Node.js 20 deprecation annotations, no failures.
   - **E2E browser** run `34872382135` — ✅ success.
   - **Deploy Staging** run `34872382193` — ✅ success. Job `Staging deploy (migrate → seed → deploy)` passed in 2m49s. Mechanism per `.github/workflows/deploy-staging.yml`: auto-fires on push to `master`, deploys the api-worker to staging (migrate → seed → deploy).

**Result**: merge = ff, push accepted, CI green on the merge commit, staging api-worker auto-deploy succeeded. No blockers.

## Task 4.2 staging rollout

Executed 2026-09-14, 17:11–17:51 UTC. Staging D1 writes explicitly approved by the task. Nothing committed; the operator's pre-existing `wrangler tail rajahinta-api-production` session was left untouched.

### Path decision

- Established ops path = operator console (`POST /ops/console/merchants` register+auto-grant, per `docs/ingestion-runbook.md` §2.0). It requires the staging `OPS_BEARER_TOKEN` Cloudflare secret — not present in any local env file, and reading/exposing it is out of scope. No ops script exists in `scripts/`. **Fell back to direct staging D1 via `wrangler d1 execute DB --remote --env staging`** (sanctioned by the task: "or direct D1 by the operator"). Note: this means no `audit_events` entry exists for these two inserts — console grants are the audited path; recorded here as a deviation for the lead.
- Ingest trigger: producer cron is hourly but the daily 86,400,000 ms bucket only crosses on the 00:00 UTC pass (~6¾ h away). Manual paths evaluated:
  - `wrangler workflows instances create` — removed in wrangler (missing in both the pinned 4.127.1 and npx 4.131.2; only list/describe/send-event/terminate/restart/pause/resume/delete remain).
  - `wrangler dev --remote --env staging` + scheduled-handler endpoint — dead end: "Queues are not yet supported in wrangler dev remote mode", so `queue.send` cannot reach the real staging queue.
  - **Used: Workflows REST API** `POST /accounts/{account}/workflows/rajahinta-price-ingestion-staging/instances` with body `{"id":"price-ingestion-longero-2026-09-14-17","params":{"merchantId":"longero","sourceUrl":"https://longero.fi","dedupeKey":"price-ingestion-longero-2026-09-14-17"}}` → `{"success":true,"status":"queued"}`. The per-instance path form (`POST …/instances/{id}`) returns `workflows.api.error.not_found` — the collection form with `id` in the body is the current contract (verify: `GET …/instances/{id}` works with the returned UUID, not the custom id; wrangler 4.127.1's `instances describe` uses the custom-id path form and 404s — tooling gap worth knowing). Auth: wrangler's own stored OAuth token (no `workflows` scope listed, but workers_scripts covers these endpoints); token handled via a 0600 temp header file, never printed, deleted after.

### Pre-checks (read-only, before any write)

- `merchant_registry`: exactly `alko` (empty feed_url, hourly) + `alks` (DE, daily 86,400,000). No longero anywhere.
- `source_governance`: exactly 1 row — id 1, alks, RETAILER_API, **`REVOKED`** ("Paused by operator 2026-09-14 — staging scraping halt; production unaffected"). **STOP-condition clear.**
- `retail_offers` for longero: 0.

### Writes (idempotent; verified by read-back)

- Registry (unique index makes re-runs no-ops): `INSERT INTO merchant_registry (merchant_id, name, country, feed_url, feed_format, polling_interval_ms) VALUES ('longero','Longero','EE','https://longero.fi','json',86400000) ON CONFLICT (merchant_id) DO NOTHING` — `changes: 1`, row read back exactly per task spec (id 3, created/updated 17:13:54Z). alko/alks rows untouched (timestamps identical).
- Governance (no unique key — `NOT EXISTS` is the idempotency guard, same pattern as local 3.1): `INSERT INTO source_governance (merchant_id, acquisition_method, permission_status, source_url, status_reason, last_verified_at) SELECT 'longero','RETAILER_API','GRANTED','https://longero.fi/wp-json/wc/store/v1/products','onboard-longero-merchant task 4.2: owner blanket permission policy — staging grant for first-ingest verification', strftime(...) WHERE NOT EXISTS (…)` — `changes: 1`, row id 2. **alks id 1 byte-identical before and after (still REVOKED, updated_at 12:09:17.113Z).**

### First ingest end-to-end

- Instance `price-ingestion-longero-2026-09-14-17` (workflow `rajahinta-price-ingestion-staging`, internal uuid `334dc0d0-8222-4017-8912-34eac910ad70`), trigger `api` — the workflow's **first instance ever** (`triggered_on: null` before it).
- All pipeline steps succeeded on first attempt: resolve-merchant → governance-gate (GRANTED honored) → fetch-feed (live longero.fi, ~7 s) → map-records → upsert-offers-1…4 (~3 min/chunk; staging D1 latency) → data-quality.
- **Incident, resolved by the engine**: `complete-job-claim-1` failed 5× with `Too many API requests by single Worker invocation` — the ~985-product upsert's cumulative D1 subrequests exhaust the invocation budget exactly at the final claim call, and step retries re-run inside the same exhausted invocation. The instance then parked in `waiting` (instance-level retry) and attempt 6 succeeded in a **fresh invocation** (cached-step replay is free) → **instance `complete`, `success: true`, end 17:50:42Z**. No queue message ever carried this dedupe key (API-triggered), so the claim was pure bookkeeping — zero data impact either way. **Follow-up for the lead**: chunk size (~250 pairs × several D1 statements) vs the ~1000-subrequest invocation cap is borderline by design; a bigger catalog (alks ≈ 2,900) would very likely strand real queue-driven runs the same way. Consider smaller `UPSERT_CHUNK_SIZE` or per-chunk invocation isolation.
- `retail_offers` after: **985 longero rows, 926 distinct products**, min 249 / max 21,730 cents, all EUR / EE / `in_stock` / `ESTIMATED`, `observed_at` 17:22:16Z (= fetch step). Reconciles with the 1.1 sweep (985 parsed) and local 3.1 (986/927 — live catalog drifts by a hair). No other merchant's offer rows changed (per-merchant counts: alks 67,600 + seed rows, longero 985 new).

### API verification (staging `rajahinta-api-staging.siim-liimand.workers.dev`)

- Negative control: `GET /api/v1/products/496` without header → `403 AGE_GATE_REQUIRED` ✅.
- `GET /api/v1/products/496` with `x-age-confirmed: confirmed` → offer `merchant: "longero"`, `country: "EE"`, `priceCents: 1799`, `availability: in_stock`, `sourceUrl: https://longero.fi/tuote/vestfyen-neipa-5-24x0-33-l/`, `observedAt: 2026-09-14T17:22:16.128Z`, provenance + €/g metric; merchant aggregate block shows `longero` offerCount 926, all ESTIMATED ✅.

### Post-checks

- `source_governance` final: 2 rows — alks **`REVOKED`** (unchanged), longero `GRANTED`. Registry: 3 rows, only longero added. Production untouched; no redeploys (the `wrangler dev --remote` probe ran a preview session only and was killed after it proved unusable).

**Result**: registry row + `RETAILER_API`/`GRANTED` governance in place via direct D1 (console token unavailable), first ingest verified end-to-end (workflow `complete`, 985 offers, API returns longero with age gate enforced), staging alks governance `REVOKED` before and after. One deviation (no audit_events for the manual inserts) and one follow-up (invocation subrequest budget vs upsert chunking) for the lead.

## Lead follow-ups (from 4.2, out of change scope)

- Manual staging D1 inserts bypass `audit_events`; the ops path (console + `OPS_BEARER_TOKEN`) is the audit-complete route — production 5.2 must use it.
- `complete-job-claim` burned 5 retries on Worker subrequest limits during the 986-offer upsert (recovered via instance-level retry). Borderline at longero scale, likely terminal at alks scale — chunk-size tuning is a separate follow-up, not this change.

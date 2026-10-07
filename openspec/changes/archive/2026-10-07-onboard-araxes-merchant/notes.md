# Onboard araxes merchant — Notes

> Execution log. Sweep numbers, rollout commands, and verification evidence are recorded here as tasks complete. TBD placeholders are filled by the operator only, never pre-filled.

## Sweep baseline (task 1.1)

`scripts/araxes-catalog-sweep.ts` (clone of the mydrink sweep, same walk discipline and report format) swept the live catalog read-only on 2026-10-07: X-WP-Total 1630, 17/17 pages ok at per_page=100, 0 page failures, rows seen == X-WP-Total. All 1630 raw rows went through `parseAlksStoreProducts` unchanged.

- Records parsed: 942 (57.8%); rows dropped: 688 (42.2%); 942 + 688 = 1630 ✓
- Drop taxonomy: one bucket only — "no canonical beverage category" 688 (42.2%); category disagreement, multi-product bundle, non-EUR price, invalid minor-unit price, missing name: all 0
- Drop attribution (multi-term rows count once per term): wine-led — Vein 455, Punane vein 168, Valge vein 166, Lahja alkohol 95, Vahuvein 71, Õlu 68, Alkoholivaba 65, uncategorized 17; spirits terms nearly clean (Kange alkohol 4 drops on 860 rows, Viski 0, Viin 3)
- SKU/EAN gap: 100% of the 1630 SKUs are internal 5-digit codes (samples 42631, 15238, 36625) — 0% match accepted EAN forms; all 1630 rows emit "kept without an EAN", so merges depend entirely on the upsert's compound tier
- Brand coverage: 0 rows (0.0%) carry a named `brands` entry → compound keys reduce to name + containerType + unitVolume
- Product type: 100% `type: simple` (no variable/price_range invalid-price risk)
- ESTIMATED share: 1 of 942 records (0.1%) — one ABV-unparsed name ("MINIKOMPLEK 4*0,04L …"); volume 0 ml: 0
- Category census: 42 distinct raw terms (probe anticipated 45), all bare Estonian; leaders: Kange alkohol 860 rows (52.8%), Vein 498 (30.6%), Viin 280 (17.2%), Punane vein 171, Valge vein 167, Viski 133, Lahja alkohol 131; non-beverage terms present (Suupisted 41, Karastusjook 24, Krõpsud 19, Energiajook 16, Pähklid 14, Mahl 10) are irreducible drops
- Additive `mapSourceCategory` exact-term candidates measured: kange alkohol 860, vein 498, viin 280, viski 133, lahja alkohol 131, liköör 79, õlu 76, siider 10; lonkero/romm/gin/vodka/tequila/pandipakend 0

**GO for tasks 1.2 and 2.1**: zero page failures, drop taxonomy fully explained (single bucket), 942 products ingest today, and the 688 drops concentrate in wine-family terms task 1.2 can map additively. The 100% EAN-less, 0%-brand reality is the constraint task 2.1 designs against (compound-tier merges only).

## Vocabulary re-sweep (task 1.2)

`SWEDISH_SOURCE_CATEGORY_MAP` gained 27 additive keys (mapper patch 2026-10-07, design D3), each keyed by the live census's exact spelling: the strong-alcohol parent `kange alkohol` plus the Estonian spirit nouns `viin`, `brändi`, `džinn`, `tekiila`, `kalvados`, `armanjakk`, `absint` → spirits; the still-wine leaves `punane vein`, `valge vein`, `roosa vein`, `puuvilja- ja marjavein` → wine; `vahuvein`, `šampanja` → sparkling-wine; `hõõgvein`, `vermut`, `liköörvein, portvein, šerri` → fortified-wine; `õlu` → beer; `long drink` → long-drink; the non-alcoholic section `alkoholivaba` with children `energiajook`, `karastusjook`, `mahl`, `vesi`, `alkoholivaba õlu`, `alkoholivaba vein`, `alkoholivaba vahuvein` → non-alcoholic. Census reconciliation: the design table's `tekila` never occurs — the store spells the term `Tekiila` (byte census `U+006B…`-style verified), so the key is `tekiila`; the design's merch term `Kotid` is gone from the live catalog while `Pähklid` 14 appeared. `viski`, `konjak`, `rumm`, `bitter`, `liköör`, `siider` already mapped and were not re-added — the sweep's `romm`/`gin`/`vodka`/`tequila` candidate needles matched 0 terms because the store's groups are `Rumm` (key `rumm`, already mapped) and `Džinn` (added), and it stocks no latin-spelled gin/vodka/tequila group. Deliberately NOT mapped (null at sub-22 % → correction queue): `vein` (the parent and its identically named leaf share the one lowercase key, 498 rows — first-mappable-in-payload-order would misfile Vahuvein/Šampanja rows as still wine; still-vs-sparkling excise split), `lahja alkohol` 131 (heterogeneous children resolve from their own leaves), `kokteilid` 23 (RTD spans tax families), and the merch terms `suupisted`, `krõpsud`, `pähklid`, `lihasnäkid`, `kommid`, `pakend`.

Re-sweep run: `pnpm --filter @rajahinta/core-domain build` (the sweep resolves the mapper through `@rajahinta/core-domain` dist) then `pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/araxes-catalog-sweep.ts` — exit 0, 17/17 pages ok, 0 page failures, 1630 raw rows seen == X-WP-Total.

| Metric | 1.1 baseline | 1.2 (after D3) |
|---|---|---|
| Records parsed | 942 of 1630 (57.8%) | **1540 of 1630 (94.5%)** |
| Dropped: no canonical beverage category | 688 (42.2%) | 87 (5.3%) |
| Dropped: category disagreement (name vs categories) | 0 | 3 (0.2%) |
| Dropped: bundle / non-EUR / invalid price / missing name | 0 | 0 |
| 1540 + 3 + 87 = 1630 ✓ | | |

### Correction-queue remainder (87 no-canonical + 3 disagreement rows, term sets verified row-by-row)

- 62 merch rows — `Krõpsud|Suupisted` 19, `Pähklid|Suupisted` 14, `Lihasnäkid|Suupisted` 8, `Kommid` 7, `Pakend` 4: snacks and packaging, deliberately unmapped.
- 17 RTD rows — `Kokteilid|Lahja alkohol` with no other leaf: both terms deliberately unmapped.
- 17 uncategorized rows — no categories at all; nothing for the mapper to read.
- 1 bare `Vein` row — the design-expected still/sparkling-ambiguous leaf; stays unmapped by design.
- 3 disagreement rows — name implies `wine_still` while categories imply `wine_sparkling` (2) or `intermediate_products` (1): the keyed-uncertainty gate flags them instead of silently resolving (mydrink 12-row precedent).

ESTIMATED share moved with the parsed volume: 70 of 1540 records (4.5%) have an ABV the name-parsing cannot read (was 1 of 942), volume 0 ml: 4 — the wine-heavy names are the driver; the attribute-aware follow-up (design D1 escape hatch) owns it if it matters. Kept-without-EAN lines remain one per row (1630; 100% internal 5-digit SKUs, 0% brands) — the task 2.1 compound-merge constraint, unchanged.

Checks: `pnpm --filter @rajahinta/core-domain build` exit 0; mapper suite `source-category.mapper.test.ts` 66/66 (11 new araxes tests: canonical + tax key per new term, any-ABV keyword attribution for the spirits terms, the 22 % boundary on the fermented-bucket terms, bare-vs-decorated key distinctness, `vein`/`lahja alkohol`/`kokteilid`/merch non-mappings); full package suite 57 files / 1599 tests passed; eslint on both touched files clean.

## Local rollout (task 3.1)

**Date**: 2026-10-07, ~10:47–11:10 UTC. Branch `feature/onboard-araxes-merchant`, clean tree. All steps LOCAL (`wrangler dev --port 8787 --test-scheduled`, `wrangler d1 execute DB --local` from apps/api-worker); live **read-only GETs** to araxes.ee only; zero staging/production contact. `@rajahinta/core-domain` rebuilt first (`pnpm --filter @rajahinta/core-domain build` exit 0 — the kippis/mydrink 3.1 stale-dist lesson). Nothing committed; only this notes section touched.

**Local D1 state found (read-only probes before any write)**: the local store had been **re-seeded since the mydrink era** — registry = alko (empty feed URL, id 1) + alks (id 2, DE, daily 86,400,000), no mydrink/longero/kippis rows; `source_governance` = 0 rows; `retail_offers` = 48 seed rows, zero araxes; `product_master` = **47 rows** (baseline count; ids are sparse — match pre-existing rows by count/created range, not `id <= 47`).

### Registry + governance inserts

- **Registry row via the seed** (task 2.2's row): `pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/seed-d1.ts --local` → migrations no-op (already applied), staging seed re-applied (explicit-id `INSERT OR IGNORE`, idempotent), **verification PASSED** — the seed's gate asserts `merchant_registry_araxes = 1`. Read-back: row **id 3**, `('araxes','Araxes','EE','https://araxes.ee','json',86400000)`, fields exact; alko/alks untouched.
- **Governance**: no `.dev.vars` on the api-worker → `OPS_BEARER_TOKEN` absent → every `/ops` route is 403 by design → **direct local INSERT** (the mydrink 3.1 path; the audited console path is for 4.2/5.2). `NOT EXISTS`-guarded INSERT (no unique key — kippis/longero/mydrink 3.1 idempotency pattern), `RETAILER_API`/`GRANTED`, sourceUrl `https://araxes.ee/wp-json/wc/store/v1/products`, reason "operator holds usage rights to the store API (adapter docblock, design D1); local GRANT for first-ingest verification". Read-back row **id 1**, all fields exact. **Local-only row — disposable.**

### Producer tick + ingestion end-to-end (mydrink 3.1 playbook)

1. **Pre-grant real-clock tick**: `curl /cdn-cgi/handler/scheduled?cron=0+*+*+*+*` → `Not scheduling merchant "araxes": no governance records — defaulting to PENDING` + `enqueued 0/3` — the §0 fail-closed contract observed (bonus verification; alko no-URL skip + alks fail-closed skip unchanged).
2. **Post-grant real-clock tick**: araxes recognized as permitted, deferred by the daily interval-bucket gate — `enqueued 0/3 … (1 not due this tick)`.
3. **Due-tick**: temporary vitest harness (deleted after the run) running the unmodified `schedulePriceIngestions` against real local bindings via `wrangler.getPlatformProxy` over the same `.wrangler/state`, with `now` = 2026-10-08T00:30:00Z (next daily boundary pass; tsx can't transform the cross-package decorator sources — vitest can) and a send-spy wrapping the real queue binding. Result: `enqueued 1/3`, exactly one message `{"dedupeKey":"price-ingestion-araxes-2026-10-08-00","merchantId":"araxes","sourceUrl":"https://araxes.ee"}` (asserted). Consumer handoff in the dev log: `Ingesting prices for merchant araxes (dedupe key price-ingestion-araxes-2026-10-08-00)` → `Handed off … to Workflow instance price-ingestion-araxes-2026-10-08-00` — no manual handoff needed, zero retries.
4. **Run 2**: same harness, `now` = 2026-10-09T00:30:00Z → key `price-ingestion-araxes-2026-10-09-00`; consumer handoff identical. Exactly one enqueue + one instance per key across both runs.

### Workflow results + idempotency evidence

| | Run 1 (`…2026-10-08-00`) | Run 2 (`…2026-10-09-00`) |
|---|---|---|
| `retail_offers` araxes | 0 → **1,540 rows / 1,540 distinct products**, min 75 / max 34,499 c | → **3,080 rows / 1,540 products** — fresh per-observation batch |
| `observed_at` batch | single batch 10:55:30.374Z→.410Z (36 ms-precision stamps = the upsert's chunk stamps within one step) | second batch ≈ 10:59:14.318Z |
| Value set | single EUR / EE / `in_stock` / ESTIMATED | unchanged |
| `product_master` | 47 → **1,587 (+1,540**, exact) | **1,587 — unchanged** |

- Reconciliation: 1,630 raw − 87 `no canonical beverage category` − 3 disagreement = **1,540** ✓ — the exact task-1.2 numbers. Max-price sample: `MACALLAN RARE CASK 0.7L 43% Whisky` 34,499 c on araxes-created row (araxes master ids span **9003–10542** = 1,540 rows exactly).
- **Compound-key idempotency holds**: run 2 matched all 1,540 of araxes's own rows by (name, `''` brand, containerType, unitVolume) — zero new `product_master` rows; offers re-upserted as a fresh per-observation batch (designed time-series shape; kippis/mydrink 3.1 precedent).
- **Parallel catalog (D4) confirmed**: all 1,540 offers sit on araxes-created rows (+1,540 exact — zero compound matches against the 47-row seed master; 100% internal 5-digit SKUs → no EAN join, per the adapter-docblock reality).
- Per-row correction lines (kept-without-EAN one per row, plus the 87 + 3 drops) are the adapter-deterministic D2 noise per the 1.2 sweep; the landed offer count reconciles exactly. The step-error list itself lives in miniflare's private workflow store (not decoded) — staging 4.2 observes it through the Workflows API, as mydrink 4.2 did.
- wrangler-dev artifact (recorded, not chased): right after each queue batch completed (`QUEUE rajahinta-price-ingestion-dev 1/1 (114ms)`) the dev runtime logged `Uncaught Error: … canceled … hung` — the consumer had already returned after the durable handoff; the workflow continued and every row landed (both runs), zero retries.
- R2: an observation blob containing araxes lines appeared under the local `rajahinta-observations-dev` bucket — the offer-change hook fired on the first changed-offer pass (§2.3 shape).

### API verification (local worker :8787, product **9044** `MACALLAN RARE CASK 0.7L 43% Whisky`, an araxes-created row)

- Without `x-age-confirmed`: **403 `AGE_GATE_REQUIRED`** ✅.
- With `x-age-confirmed: 1`: araxes offer — `merchant: "araxes"`, `country: "EE"`, `priceCents: 34499`, EUR, `in_stock`, `sourceUrl: https://araxes.ee/toode/macallan-rare-cask-0-7l-43-whisky/`, `reliabilityStatus: ESTIMATED`, `observedAt: 2026-10-07T10:59:14.303Z` (= run-2 batch) ✅. Product row `ean: null`, `depositSystemStatus: false` (D5) ✅.
- Merchant aggregate (product payload and `GET /api/v1/merchants/reliability`): **`araxes` offerCount 1540**, all ESTIMATED, `freshestObservedAt` = run-2 batch ✅.
- Ranked search serves araxes-created products (`q=macallan` → the id-9044 row, `lowestPriceCents: 34499`) ✅.
- Same read-model artifact as kippis/mydrink: the aggregate reports `governancePermissionStatus: "PENDING"` while the D1 row is `GRANTED` (the producer + workflow gates honored the grant) — observation recorded, not investigated.

**Environment cleanup**: harness file deleted; `wrangler dev` stopped; `/tmp` log removed. No tracked file changed except this notes section.

## Staging rollout (task 4.2)

**COMPLETE — grant landed and audited; ingest verified after the chunk-budget fix: all 1,540 araxes products carry offers across exactly two observation batches.** Executed 2026-10-07 12:16–14:20 UTC. Zero production contact throughout.

### Deploy blocker (incident, resolved upstream)

The first deploy of the change (run **37614170668**, PR #99 merge `9b4be74`) failed at the seed gate: the D1 seed emitted registry rows with dense explicit PKs (araxes→3), which staging's operator-added **longero** row (id 3) swallowed via `INSERT OR IGNORE` → verification `merchant_registry_araxes: expected 1, got 0` → deploy aborted. Fixed upstream as a natural-key upsert on the UNIQUE `merchant_id` (PR #100, merge `426f310`); redeploy run **37619808775 GREEN** (migrate → seed verified → workers rolled out → readiness gate OK). Staging now runs the six-adapter code with the araxes registry row (read-back: Araxes / EE / `https://araxes.ee` / json / 86,400,000).

### Ops-console precondition — staging `OPS_BEARER_TOKEN` was NEVER provisioned

First `GET /ops/console/governance` attempt → generic 403 (fail-closed by design, `ops-access.ts`). `wrangler secret list --env staging` showed a single secret (`CONTACT_IP_HASH_SALT`) — **no `OPS_BEARER_TOKEN`** (runbook §1 precondition never met for staging; this is the deeper form of the mydrink-4.2 blocker, which only lacked the value locally). Provisioned 2026-10-07 via `wrangler secret put OPS_BEARER_TOKEN --env staging` from the environment credential file (value piped via stdin, never displayed). The audited console path then worked — **no direct-D1 fallback was needed; no `audit_events` deviation this time.** Note for 5.x: verify the production secret exists before the production grant (checked by NAME only here; production not probed).

### Fail-closed pre-grant check (console, post-deploy)

`GET /ops/console/governance`: **`araxes` PENDING, sourceCount 0** (registry row from seed, no governance records) — the §0 fail-closed contract, verified before any grant. `alks` still `REVOKED` (staging halt untouched); kippis/longero/mydrink `GRANTED` unchanged.

### Grant through the operator console (audited path)

`POST /ops/console/governance/araxes/grant` — operator **`siim (owner)`** (the audit-trail convention, from the 2026-09-11 alks entry), `acquisitionMethod: RETAILER_API`, `sourceUrl: https://araxes.ee/wp-json/wc/store/v1/products`, note "change onboard-araxes-merchant: staging grant" → **`permissionStatus: GRANTED`, `changed: true`, `updatedSources: 1`** ✅. Audit verified (`GET /ops/console/audit?limit=5`): entry `73a22145…`, `entityType: source_governance`, `entityId: araxes`, `action: created`, author + note exact, 2026-10-07T12:23:58Z ✅.

### Pre-ingest baselines (read-only D1)

`product_master` **6,161 rows, max id 6,161**; `retail_offers` **114,434 total, araxes 0**; per-merchant: alks 67,600 · longero 24,962 · kippis 14,235 · mydrink 7,593 · seed merchants 8–10.

### First ingest via the Workflows REST API

- `POST /accounts/{account}/workflows/rajahinta-price-ingestion-staging/instances` body `{"id":"price-ingestion-araxes-2026-10-07-12","params":{"merchantId":"araxes","sourceUrl":"https://araxes.ee","dedupeKey":"price-ingestion-araxes-2026-10-07-12"}}` (params mirror the producer's queue message: registry feedUrl as sourceUrl — the adapter appends the Store API path; `-12` hour key cannot collide with the disabled producer) → `success: true`, internal uuid **`1c2cddc7-f0cb-47bf-a2dc-897a91b4681c`**, `status: "queued"`, first attempt.
- Poll: `queued` → `running` 12:24:54Z → **`waiting` 13:11:35Z** (~47 min; the designed chunk-budget hibernation boundary — araxes at 7 upsert chunks is the first mid-size catalog to reach the sleep path) → **`complete` 13:14:48Z (≈50 min total)**, `error: null`.

### Run result — 1,000 of 1,540 offers; the rest rejected by the D1 API-request quota (BUG)

Instance output: **`productsIngested: 1000`**, `errors`: **2,266 lines** (2,265 unique). Exact reconciliation: **1,630 raw = 1,000 ingested + 540 quota-rejected + ~90 expected drops** ✓. Of the error lines, **exactly 540** are per-row `Failed to upsert product "…": Too many API requests by single Worker invocation` — upsert chunks **5–7** (250+250+40 pairs); the remaining ~1,726 lines are the expected adapter noise (kept-without-EAN note per raw row + the drop lines, local-3.1 shape). The instance reports `complete` because upsert failures ride the in-band error list by design (completed-with-errors), not step failure.

Root cause (diagnosed; fix owned by the workflow owner): `ingestion-steps.ts` chunks the upsert at `UPSERT_CHUNK_SIZE = 250` and crosses a durable-sleep boundary (fresh invocation → fresh D1 API-request quota) only every `CHUNK_BUDGET_RESET_EVERY = 16` chunks — sized from the 2026-09-30 production Alko run (~350 chunks). A 1,540-pair catalog needs only **7 chunks**, so the quota (shared across the instance's executions within one invocation stretch) dies at ~1,000 rows, before the first boundary. mydrink's 643 (3 chunks) never reached the failure window; Alko/alks-scale runs cross boundaries long before it. Deterministic: re-triggering lands the same 1,000 and rejects the same 540 — a re-run is NOT a remediation. Remediation direction: shrink the reset interval (e.g. every 4 chunks ≈ 1,000-row budget) or make the reset quota-aware. The 540 rejected pairs persisted nothing (product upsert itself failed; no partial rows — see +1,000 exact below).

### Verification of what landed

- **`retail_offers`**: **1,000 araxes rows / 1,000 distinct products** (expected 1,540), min 159 / max 34,499 cents (max = `MACALLAN RARE CASK 0.7L 43% Whisky`, the local-3.1 sample item), single `observed_at` batch **2026-10-07T12:25:22.205Z** (= fetch step), reliability **all 1,000 ESTIMATED** — matching local 3.1's verified behavior ("offerCount 1540, all ESTIMATED"; the ~4.5% figure is the sweep's parse-share estimate, not the ingestion reliability distribution).
- **`product_master`**: 6,161 → **7,161 (+1,000 exact)**; all 1,000 new rows EAN-less (araxes internal 5-digit SKUs, D4 parallel-catalog shape). **No other merchant changed**: post-run per-merchant counts byte-identical to baseline.
- **API** (`https://rajahinta-api-staging.siim-liimand.workers.dev`, product **6203** — araxes-created max-price row): negative control `GET /api/v1/products/6203` without header → **HTTP 403** (age gate) ✅; with `x-age-confirmed: 1` → the araxes offer: `merchant "araxes"` / EE / 34,499¢ / EUR / ESTIMATED / `sourceUrl: https://araxes.ee/toode/macallan-rare-cask-0-7l-43-whisky/` / `observedAt` = fetch batch ✅. Merchant aggregate: **`araxes` offerCount 1000**, all ESTIMATED, `freshestObservedAt` = fetch batch ✅, with the known read-model artifact (`governancePermissionStatus: "PENDING"` despite the GRANTED row — kippis/mydrink/local precedent, recorded not chased).

### Commands executed (names) — run-1 phase (pre-fix)

`gh run list --workflow deploy-staging.yml` · `curl GET/POST $STAGING_API_URL/ops/console/governance|audit|governance/araxes/grant` (bearer: `$(cat /root/.ops-token)` inline, never echoed) · `npx wrangler secret list --env staging` · `npx wrangler secret put OPS_BEARER_TOKEN --env staging` (value from the environment credential file via stdin, never displayed) · `npx wrangler whoami --json` + `curl POST /accounts/{account}/workflows/rajahinta-price-ingestion-staging/instances` + `curl …/instances/1c2cddc7-…` (poll; Cloudflare API token inline, never echoed; account id same-invocation, never emitted) · read-only `npx wrangler d1 execute DB --remote --env staging --json --command "…"` (baselines, offer/product/verification queries, per-merchant post-checks) · `curl /api/v1/products/6203` ± `x-age-confirmed: 1` · `curl /api/v1/merchants/reliability`. Instance error lines fetched via the Workflows API to a `/tmp/opencode` scratch file (product names only, no credentials), deleted after analysis. No writes against staging D1 by hand; no production contact.

### Blocker — quota bug found by run 1, FIXED, reconciled by run 2

Run 1 (instance **`1c2cddc7-f0cb-47bf-a2dc-897a91b4681c`**, complete 13:14:48Z) exposed the bug: `CHUNK_BUDGET_RESET_EVERY = 16` meant a 7-chunk (1,540-pair) catalog exhausted the shared per-invocation D1 API-request quota before the first sleep boundary — chunks 5–7 rejected all 540 rows per-row ("Too many API requests"), landing only 1,000/1,540. **Fixed upstream (PR #101, `8da227e`: reset interval 16 → 2; deploy run 37629508334 green).** Deterministic-failure analysis held: a plain re-run after the fix reconciled everything.

### Second ingest — run 2 (post-fix) — all pairs landed

- Pre-run baselines: araxes 1,000 rows / 1,000 products; `product_master` 7,161.
- `POST …/workflows/rajahinta-price-ingestion-staging/instances` body `{"id":"price-ingestion-araxes-2026-10-07-13","params":{…same shape…}}` → uuid **`9f0cd8da-5de9-43a3-a551-2f4f2df84cfa`**, `queued`, first attempt → **`complete` 14:10:50Z (≈32 min)**, `error: null`.
- Output **`productsIngested: 1539`**, `errors`: **1,724 lines, ZERO quota rejections** ✓. Feed drift, not loss: the raw catalog moved 1,630 → **1,629** between runs (12:24 vs 13:38 fetch), and run 2 reconciles exactly: **1,539 parsed + 87 no-canonical + 3 disagreement = 1,629 ✓**, with **1,629 SKU correction notes** (one per raw row — the accepted D2 discipline).

### Final state (reconciled against local 3.1 semantics)

- **`retail_offers`**: **2,789 araxes rows across exactly two `observed_at` batches** — the designed per-observation append shape (mydrink local 3.1: run 2 appended a full fresh batch): batch 1 **1,000 rows @ 2026-10-07T12:25:22.205Z** (run 1, preserved), batch 2 **1,789 rows @ 13:39:02.774Z** over 1,539 products. Total **1,540 distinct products with offers** ✓ (1,000 refreshed + 540 previously-rejected landed).
- **Chunk-replay wrinkle (recorded for the workflow owner, not a 4.2 blocker)**: batch 2 carries **250 same-price duplicate rows** (1,289 products ×1 + 250 ×2 = 1,789) — exactly one `UPSERT_CHUNK_SIZE = 250` chunk appended twice at the same instant, the at-least-once signature of a chunk whose D1 writes committed before its step checkpoint was lost (run 2 crossed the new sleep boundaries at chunks 2/4/6). The upsert comment's "same-instant offer upsert is a no-op" contract did not hold on replay. Harmless to numbers (identical rows; the read path serves only the freshest observation per product; time-series aggregation is bucket-idempotent), but per-product offer listings could double-count — dedupe/append-guard follow-up for the platform engineer.
- **`product_master`**: 7,161 → **7,701 (+540 exact, all EAN-less)** — the previously-rejected products. **No other merchant changed**: mydrink 7,593 · kippis 14,235 · longero 24,962 · alks 67,600 — byte-identical to the 4.2 baseline and unchanged across both runs.
- **API** (`https://rajahinta-api-staging.siim-liimand.workers.dev`, product **6203**, araxes-created max-price row — one offer row per batch, the clean two-batch shape): no header → **HTTP 403** ✅; `x-age-confirmed: 1` → araxes offer at the fresh batch (`34,499`¢, `observedAt` 13:39:02.774Z) ✅. Merchant aggregate: **`araxes` offerCount 1540**, all ESTIMATED, `freshestObservedAt` = batch 2 ✅ (known read-model artifact: `governancePermissionStatus: "PENDING"` despite the GRANTED row — kippis/mydrink/local precedent, recorded not chased).

### Commands executed (names) — run-2 phase (post-fix verification)

`gh run list --workflow deploy-staging.yml` (run 37629508334 green) · read-only `npx wrangler d1 execute DB --remote --env staging --json --command "…"` (pre-run baselines; post-run batch split, duplicate-row census, product/merchant checks) · `npx wrangler whoami --json` + `curl POST …/workflows/rajahinta-price-ingestion-staging/instances` (key `price-ingestion-araxes-2026-10-07-13`) + `curl …/instances/9f0cd8da-…` (poll; Cloudflare API token inline, never echoed) · instance error-line fetch to a `/tmp/opencode` scratch file for category counting (SKU notes / no-canonical / disagreement / quota-rejection greps; file deleted) · `curl /api/v1/products/6203` ± `x-age-confirmed: 1` · `curl /api/v1/merchants/reliability`.

## Production rollout (task 5.2)

Executed 2026-10-07, ~14:17–16:00 UTC, with the user's explicit production approval (staging verified in 4.2). Deploy first, then registration, then ingest — runbook §3 order. All commands name-only; tokens used inline (`$(cat /root/.cloudflare-token)`, `$(cat /root/.ops-token)`), never echoed, never committed.

### 5.1 — Gated production deploy (green)

`gh workflow run deploy-production.yml --ref master -f confirm_deploy=yes` → run **37635518440** (master @ `8da227e` — six-adapter code + chunk-budget fix; the branch differs from master only by notes/tasks files). All steps ✓: build → **Apply D1 migrations (production)** → API/email/frontend Worker deploys → **health gate** (`/api/v1/health/ready` 200). Dispatched 14:17:56Z, completed ~14:23Z. Only pre-existing deprecation-warning annotations.

### Secret precondition — already provisioned (no action, unlike staging)

`wrangler secret list --env production` (name-only) → **`OPS_BEARER_TOKEN` present** (alongside `CONTACT_IP_HASH_SALT`, `EMAIL_SEND_SECRET`). Confirmed working before any write: `GET /ops/console/governance` with the ops token → **HTTP 200** (staging's 403-provision path not needed). No `audit_events` deviation this change.

### Fail-closed sanity before registration (STOP condition clear)

`GET /ops/console/governance`: 5 merchants (alko, alks, kippis, longero, mydrink — all `GRANTED`), **araxes absent** — no governance records, not GRANTED ✓. Pre-ingest baselines (read-only D1): `product_master` **11,585 / max 11,585**; `retail_offers` **120,707 total, araxes 0**; per-merchant alko 14,037/7,116 · alks 62,172/2,883 · kippis 14,233/637 · longero 23,163/982 · mydrink 7,102/652.

### Registration — audited console upsert + auto-grant (§2.0, one action)

`POST /ops/console/merchants` (`feedFormat`/`pollingIntervalMs` pinned per §2.0) → **`registered: "created"`, `autoGranted: true`, `permissionStatus: "GRANTED"`, `sourceCount: 1`** at 14:23:44Z. Audit verified (`GET /ops/console/audit?limit=5`) — **exactly two entries**, author `siim (owner)`, note "owner blanket permission policy — change onboard-araxes-merchant" on both: `merchant_registry`/`araxes`/`created` (id `85cc87b2…`, 14:23:44.318Z) and `source_governance`/`araxes`/`created` (id `a51ea590…`, 14:23:44.818Z). Governance re-check: `araxes` **GRANTED**, sourceCount 1, total 6 merchants.

### First ingest — run 1: 1,000 of ~1,539; 539 quota rejections (DEVIATION — boundary did not reset quota)

`POST …/workflows/rajahinta-price-ingestion-production/instances` body `{"id":"price-ingestion-araxes-2026-10-07-14","params":{"merchantId":"araxes","sourceUrl":"https://araxes.ee","dedupeKey":"price-ingestion-araxes-2026-10-07-14"}}` (params mirror the producer message; `-14` hour key cannot collide with the daily key `price-ingestion-araxes-2026-10-08-00`) → uuid **`ac23e53d-f6ee-4486-b57e-2852cff5f51e`**, `queued`, first attempt → `complete` 15:14:08Z.

Output **`productsIngested: 1000`**, `errors` 2,262 lines: **exactly 539** per-row `Failed to upsert product "…": Too many API requests by single Worker invocation` + 91 no-canonical + 1,632 SKU notes. Reconciliation: **1,630 raw = 1,000 landed + 539 quota-rejected + 91 drops** ✓ (1.1 sweep census). Same 1,000/539 split as staging run 1 — **but this time WITH the fix deployed** (instance `versionId 079e50fc…` = the 8da227e deploy). Step timeline is the finding: `upsert-offers-1..4` each ~8.5 min (real work, 250 pairs), then after the 1s `chunk-budget-reset-3/5/7` sleeps, **`upsert-offers-5/6/7` completed near-instantly with every pair quota-rejected** — the durable sleep boundary did **not** produce a fresh D1 API-request window in production, unlike staging run 2 (same code: parks observed, all pairs landed). The `waiting` my status poll saw 15:11–15:14 was `complete-job-claim` retry backoff (6 attempts × exponential 30 s ≈ 15.5 min), not a hibernation park. **Production-falsified premise recorded for the platform engineer: `CHUNK_BUDGET_RESET_EVERY = 2`'s 1 s `step.sleep` is not a reliable invocation/quota reset in production — a future cold mid-size catalog (~1,540 pairs) will reproduce run 1's tail-chunk failure shape.** The 539 rejected pairs persisted nothing: `product_master` 11,585 → 12,585 (**+1,000 exact**, EAN-less), single araxes batch 1,000 rows @ 14:24:48.129Z, no other merchant moved.

### Run 2 — reconciliation re-run: everything landed

Idempotent manual re-trigger (mydrink-5.2/staging-4.2 method; re-run pairs are cheap — the 2026-09-30 Alko measurement puts quota death at ~10 k re-run pairs): body `{"id":"price-ingestion-araxes-2026-10-07-15",…}` → uuid **`f17e96f5-e64b-4ad2-90cb-d65b7de633e6`** → `complete` 15:55:50Z (~28 min). Output **`productsIngested: 1539`**, `errors` 1,724 lines, **ZERO quota rejections** ✓: 1,632 SKU notes + 92 no-canonical; **1,539 + 92 = 1,631 raw** (feed drifted +1 item since run 1's 14:24 fetch). Chunks 1–4 (1,000 re-run pairs) 2–2.5 min each; chunks 5–7 (the 539 first-run pairs) 8.5–9 min each — all inside one effective budget window, confirming both the diagnosis and the re-run economics.

### Final state — reconciled

- **`retail_offers`**: **2,539 araxes rows across exactly two `observed_at` batches** — batch 1: 1,000 @ 2026-10-07T14:24:48.129Z (run 1, preserved); batch 2: **1,539 rows @ 15:27:56.390Z over 1,539 distinct products** (run 2). Total **1,539 distinct products** ✓. Clean two-batch shape — **no** duplicate-row replay wrinkle this time (batch 2 rows = products 1:1; staging's 250-dup signature absent).
- **`product_master`**: 12,585 → **13,124 (+539 exact, all EAN-less)** — the run-1-rejected products. **No other merchant changed**: alko 14,037 · alks 62,172 · kippis 14,233 · longero 23,163 · mydrink 7,102 — byte-identical to baseline across both runs.
- **Public API** (`https://api.rajahinta.fi`, product **12585** `MARTINI ROSE 0.75L 11.5% Vahuvein`, araxes-created): bare → **HTTP 403** (age gate) ✅; `x-age-confirmed: 1` → HTTP 200, araxes offer **1,005¢** / EUR / `in_stock` / ESTIMATED / `sourceUrl https://araxes.ee/toode/martini-rose-…` / `observedAt` = batch 2 ✅. Merchant aggregate: **`araxes` offerCount 1539**, all ESTIMATED, `freshestObservedAt` = batch 2 ✅ (known read-model artifact: `governancePermissionStatus: "PENDING"` despite the GRANTED D1 row — kippis/mydrink/local precedent, recorded not chased).
- **Public product page** (`https://rajahinta.fi/products/12585`, HTTP 200): server-rendered araxes offer row (offer id 152987 after run 1 → **153987** after run 2) with the outbound CTA (`Katso kaupassa →`, `rel="nofollow noopener"`) — the page serves araxes items without client fetches (mydrink 5.2 method; crawlable-soft-gate satisfied).
- Post-ingest readiness: `/api/v1/health/ready` 200 (`d1` up), `https://rajahinta.fi/` 200.

### Commands executed (names)

`gh workflow run deploy-production.yml --ref master -f confirm_deploy=yes` + `gh run watch` · `npx wrangler secret list --env production` (names only) · `curl GET /ops/console/governance` + `POST /ops/console/merchants` + `GET /ops/console/audit?limit=5` (bearer `$(cat /root/.ops-token)` inline, never echoed) · read-only `npx wrangler d1 execute DB --remote --env production --json --command "…"` (baselines, batch splits, per-merchant post-checks, product/verification queries) · `npx wrangler whoami --json` (account id captured same-invocation, never emitted) + `curl -X POST /accounts/{account}/workflows/rajahinta-price-ingestion-production/instances` ×2 + `curl …/instances/<uuid>` polls (Cloudflare API token inline, never echoed; step/error output to `/tmp/opencode` scratch, deleted) · `npx wrangler deployments list --env production` (version check) · `curl /api/v1/products/12585` ± `x-age-confirmed: 1` · `curl https://rajahinta.fi/products/12585` · `curl /api/v1/health/ready` · `curl https://rajahinta.fi/`.

### Deviations / notes vs the staging 4.2 playbook

1. **Run-1 quota rejections with the fix deployed** (explicit, for the platform engineer): production's instance ran `8da227e` (reset every 2) and still lost chunks 5–7 to the shared per-invocation D1 quota — the 1 s sleep boundary did not yield a fresh window. Follow-up: make the reset quota-aware or verify engine hibernation semantics per environment; until then, treat a cold mid-size catalog ingest in production as a two-run procedure (or re-run on quota-tail errors). Tonight's 00:00 UTC pass is a full re-run profile and should land clean regardless (see checklist).
2. Two manual instances for one task (run 2 = sanctioned idempotent remediation; the producer's daily key `…-10-08-00` remains reserved for the boundary pass — no collision).
3. Read-model artifact (recurring, out of scope): merchant aggregate `governancePermissionStatus: "PENDING"` despite the GRANTED D1 row; the governance-gate step itself evaluated `permitted: true, status: GRANTED`.

### FOLLOW-UP CHECKLIST — next scheduled boundary 2026-10-08 00:00 UTC

The manual instances above are trigger `api` with hour-suffixed ids; araxes is daily (86,400,000 ms — interval-bucket gate fires on the 00:00 UTC pass). Operator observation for tomorrow (NOT blocking this task):

- [ ] **Exactly one `araxes` enqueue** from the producer tick: one queue message with dedupe key **`price-ingestion-araxes-2026-10-08-00`** (the other daily merchants — alks, longero, mydrink, kippis, alko — enqueue their own separate messages; one per permitted merchant).
- [ ] **Exactly one new araxes workflow instance** in `rajahinta-price-ingestion-production`, id `price-ingestion-araxes-2026-10-08-00` — no duplicates; the manual `-14`/`-15` instances above must NOT re-run.
- [ ] **Offers refreshed**: a fresh batch 3 of ~1,539 rows at `observed_at` ≈ the boundary (re-run profile — expect zero or a tiny quota-rejection tail; if any "Too many API requests" lines appear, they are deviation 1's bug class on the drifted-new items — record and re-run once). Read path serves the freshest observation per product; alks/longero/kippis/mydrink/alko rows untouched by the araxes run.
- [ ] Check commands: `npx wrangler tail --env production` on the api-worker across the tick, or Workers Logs; `GET /accounts/{account}/workflows/rajahinta-price-ingestion-production/instances` (auth: wrangler-stored token via 0600 temp header file, deleted after) for the single-instance check; read-only `npx wrangler d1 execute DB --remote --env production --json --command "SELECT observed_at, COUNT(*) FROM retail_offers WHERE merchant='araxes' GROUP BY observed_at ORDER BY observed_at"` for the refresh check.
- [ ] Recorded 2026-10-07 ~16:05 UTC, ~8 h before the boundary.

## Verification evidence (task 6.1)

Recorded 2026-10-07, branch `feature/onboard-araxes-merchant` at the post-merge HEAD (origin/master merged in first — the verified tree is what production runs). All commands exit 0 unless marked.

| Command (CI-canonical, mirrored from `.github/workflows/ci.yml`) | Result |
|---|---|
| `git fetch origin && git merge origin/master` | merge commit `604e588` (ort) |
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm --filter @rajahinta/core-domain build` | exit 0 (rebuild-first contract) |
| `pnpm run typecheck` (workspace `-r`) | exit 0 |
| `pnpm run lint` | exit 0 |
| `pnpm run lint:content` (FI copy rules; no copy touched — clean) | exit 0 |
| `pnpm run test` (unit, workspace-wide, **Node 24**) | exit 0 — **6,368 passed, 3 skipped**: core-domain 1,599 · data-platform 843 · data-acquisition 433 · api-worker 1,261 · frontend 1,392 · application-api 738 (+3 skipped) · email-worker 83 · backend 19 |
| `pnpm run test:e2e` (vitest HTTP-level, in-memory backend) | exit 0 — 15/15 |
| `pnpm --filter @rajahinta/api-worker run test:e2e` (CI worker-checks) | exit 0 — 25/25 |
| `pnpm run test:d1` (`vitest.config.d1.ts`) | exit 0 — 168/168 |

**Node 24 is load-bearing for the whole battery** (not just the D1 harness): under the host's Node 22 the first unit pass failed 129 data-platform + api-worker tests with `no such module: fts5` (`node:sqlite` without FTS5); re-run under `/tmp/opencode/node24` (v24.13.0, CI's version) all green. Playwright browser-e2e (`test:e2e-browser`) stays CI-only per the task note — its local-infra-heavy path is exercised by the green CI runs below; the vitest e2e suite (the canonical local command) ran green above.

**CI references (e2e evidence via green runs on the three merged PRs):** PR #99 (`9b4be74`) run **37614170640**, PR #100 (`426f310`) run **37619808876**, PR #101 (`8da227e`) run **37629508377** — all `CI / ci-pass` success on 2026-10-07, each carrying e2e-tests, d1-tests, worker-checks (api-worker e2e + OpenNext build + wrangler dry-runs), golden-dataset, data-quality, compliance, composition-smoke, and integration against Postgres/TimescaleDB+Redis.

**Four evidence points → note-section pointers:**

1. **Sweep before/after drop rates** — [Sweep baseline (task 1.1)] + [Vocabulary re-sweep (task 1.2)]: 942/1,630 parsed (57.8%, 688 dropped 42.2%) → 1,540/1,630 (94.5%, 87 no-canonical + 3 disagreement); 1,540+3+87 = 1,630 ✓.
2. **Staging serving the araxes catalog** — [Staging rollout (task 4.2), final state]: API product 6203 403-without-header / araxes offer with header, `araxes` offerCount 1540 across exactly two batches, staging deploy run 37629508334 green.
3. **Production serving the araxes catalog** — [Production rollout (task 5.2), final state]: API product 12585 403/200 with araxes offer (1,539 distinct products), public page `rajahinta.fi/products/12585` HTTP 200 with the server-rendered araxes row + CTA, production deploy run 37635518440 green.
4. **Compound-key idempotency across runs** — [Local rollout (task 3.1), workflow results]: run 2 matched all 1,540 araxes rows by (name, `''` brand, containerType, unitVolume) with `product_master` stable at 1,587; same shape held at staging (7,161 → 7,701 only for first-run-rejected products, then stable) and production (12,585 → 13,124, no other merchant moved across either run).
5. **Daily-single-enqueue from the producer logs** — [Local rollout (task 3.1), producer tick]: fail-closed pre-grant (`Not scheduling merchant "araxes": no governance records — defaulting to PENDING` + `enqueued 0/3`), interval-bucket defer post-grant (`enqueued 0/3 … (1 not due this tick)`), then the due tick `enqueued 1/3` with exactly one message `{"dedupeKey":"price-ingestion-araxes-2026-10-08-00","merchantId":"araxes","sourceUrl":"https://araxes.ee"}` and the consumer handoff line `Ingesting prices for merchant araxes (dedupe key …)` → `Handed off … to Workflow instance …` — one enqueue + one instance per daily key across both harness runs (also `-10-09-00`). The raw dev log was deleted in the 3.1 cleanup; these quoted fragments are the recorded run output. Production's first scheduled boundary (2026-10-08 00:00 UTC) is the follow-up checklist above — observation pending, explicitly not a 6.1 blocker.

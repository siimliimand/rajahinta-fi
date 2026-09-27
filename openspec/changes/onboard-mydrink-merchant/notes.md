# Onboard mydrink merchant — Notes

## Task 1.1 — Catalog sweep (2026-09-27)

Script: `scripts/mydrink-catalog-sweep.ts` (cloned from `kippis-catalog-sweep.ts`; added brand-coverage and product-type censuses). Read-only: GETs only.

Run command:

```
pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/mydrink-catalog-sweep.ts
```

### Walk

- Collection: `https://mydrink.ee/wp-json/wc/store/v1/products`, `per_page=100`, sequential.
- X-WP-Total 707, 8 pages declared, 8/8 fetched ok, zero page failures, zero row drift.

### Headline numbers

| Metric | Value |
|---|---|
| Records parsed (production parser, unchanged) | 263 of 707 (37.2%) |
| Dropped: no canonical beverage category | 443 (62.7%) |
| Dropped: category disagreement (name vs categories) | 1 |
| Dropped: non-EUR / invalid price / missing name | 0 |
| SKUs matching an accepted EAN form | 0 of 707 (all internal codes, e.g. `MTJLD0078-1`, `MTBE026-1-2-1`) |
| Rows with a named `brands` entry | 0 of 707 |
| `type: simple` | 707 of 707 |
| ABV unparsed | 3 of 263 records (1.1%) |
| Volume unparsed | 0 |

### Category census (top terms, 70 distinct)

`Kange alkohol ▾` 251, `☝️ Pakkumised ▾` 178, `Pandipakend` 153, `Veinid ▾` 152, `Avaleht` 140, `Punased` 107, `Valged` 102, `Pakiveinid` 86, `☝️ Kange` 82, `☝️ Lahja alkohol` 77, `Liköör` 70, `Kokteilijoogid` 64, `Kingiideed ▾` 55, `Prantsuse` 55, `Õlu ▾` 52, `Vodka` 52, `Itaalia` 46, `Konjak` 38, `Hispaania` 36, `Viski` 36, `Eesti` 33, `Muu` 29, `Shampanjad` 28, `Kokteil` 27, `Alkoholivaba ▾` 25, `Austraalia` 24, `Vahuveinid` 22, `Karastusjoogid` 19, `Rumm` 19, `Tšiili` 17. Full list in the sweep output; `Siider` 14, `Gin` 15, long tail of country/usage terms.

### Go/no-go

GO for 1.2 (vocabulary: design D3 table) and 2.1 (adapter). The 1 disagreement drop and 3 ABV-missing records are within the parser's existing keyed-uncertainty discipline.

### Merge-path facts (owner confirmed no EAN data)

- EAN tier will never fire; compound tier (name, `''` brand, containerType, unitVolume) owns matching.
- Repeat runs idempotent; mydrink forms its own catalog rows (alks/longero parallel-catalog precedent).
- Name edits on the merchant side create a new row beside the old one; data-quality pass owns reconciliation.

## Task 1.2 — Re-sweep after vocabulary extension

Rerun after extending `SWEDISH_SOURCE_CATEGORY_MAP` with the D3 vocabulary (15 additive keys — the 14 uncovered terms plus Estonian double-ö `liköör`; the single-ö Swedish `likör` key does not match it, verified by byte census `U+00F6 U+00F6` vs `U+00F6`). The store's ` ▾` decoration is part of the raw term: census output bytes confirm `U+0020` + `U+25BE` (e.g. `Kange alkohol ▾`), matching the map keys exactly. `viski` needed no key (already maps to spirits).

Run command: `pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/mydrink-catalog-sweep.ts` — exit 0, 8/8 pages ok, zero page failures, read-only.

### Headline numbers (vs task 1.1)

| Metric | 1.1 | 1.2 (after D3) |
|---|---|---|
| Records parsed | 263 of 707 (37.2%) | 643 of 707 (91.0%) |
| Dropped: no canonical beverage category | 443 (62.7%) | 52 (7.4%) |
| Dropped: category disagreement (name vs categories) | 1 | 12 (1.7%) |
| Dropped: non-EUR / invalid price / missing name | 0 | 0 |
| 643 + 52 + 12 = 707 ✓ | | |

The 12 disagreement rows: name tokens imply wine_sparkling while the category payload's first mappable term is now `kange alkohol ▾` (spirits). The parser's contradiction gate flags them for the correction queue instead of silently resolving — keyed-uncertainty discipline, unchanged.

### Wine-leaf remainder (design-expected)

5 rows still drop on "no canonical beverage category" because only the `veinid ▾` parent applies (the term attributes 157 error lines: 152 are the expected kept-without-EAN lines, 5 are the category drops). Sparkling resolves only from its own leaves; wine rows with no leaf stay unmapped and fall to the correction queue — correct D3 behavior, not a failure. The rest of the 52 no-canonical drops carry only promo/navigational or RTD-cocktail terms (`kokteilijoogid`/`kokteil`, deliberately unmapped).

### Checks

- `pnpm --filter @rajahinta/core-domain build` exit 0 (mapper change is compiled into dist, which the sweep resolves through `@rajahinta/core-domain`).
- `pnpm --filter @rajahinta/core-domain test`: 56 files / 1427 tests passed, including 10 new mydrink vocabulary tests (canonical + tax key per new term, case/trim on the ` ▾`-decorated keys, `veinid ▾` and cocktail non-mappings, viski/likör regressions).

## Task 3.1 — Local rollout

**Date**: 2026-09-27. All steps LOCAL (`wrangler dev --port 8788`, `wrangler d1 execute DB --local` from apps/api-worker); live **read-only GETs** to mydrink.ee only; zero staging/production contact. `@rajahinta/core-domain` rebuilt first (`pnpm --filter @rajahinta/core-domain build` — the kippis 3.1 stale-dist lesson). Nothing committed; only this notes section touched.

**Local D1 state found (read-only probes before any write)**: the local store had been **re-seeded since the kippis era** — registry = alko (empty feed URL, id 1) + alks (DE, **daily** 86,400,000, id 2), no longero/kippis rows; `source_governance` = 0 rows; `retail_offers` = 48 seed rows, zero mydrink; `product_master` = **47 rows** (baseline count; ids are sparse — seed rows carry high explicit ids, so match pre-existing rows by count/created_at, not `id <= 47`).

### Registry + governance inserts (idempotent, no existing row touched)

- Registry: `INSERT INTO merchant_registry (…) VALUES ('mydrink','MyDrink','EE','https://mydrink.ee','json',86400000) ON CONFLICT (merchant_id) DO NOTHING` — read-back row **id 3**, all fields exact per D5.
- Governance: `NOT EXISTS`-guarded INSERT (no unique key — kippis/longero 3.1 pattern), `RETAILER_API`/`GRANTED`, sourceUrl `https://mydrink.ee/wp-json/wc/store/v1/products`, reason: "owner-operated site — documented scraping right (kippis/longero precedent); local GRANT for first-ingest verification". Read-back row **id 1**, all fields exact. alko/alks rows untouched; `depositSystem` not part of either table row (parser hardcodes false for foreign merchants — D5).

### Producer tick + ingestion end-to-end (kippis 3.1 playbook)

1. **Real-clock tick**: `curl /cdn-cgi/handler/scheduled?cron=0+*+*+*+*` → `enqueued 0/3 … (1 not due)` — alko no-URL skip + alks fail-closed skip (zero governance rows since the reseed) unchanged; mydrink **recognized as permitted and deferred by the daily interval-bucket gate** at 14:47 UTC.
2. **Due-tick**: temporary vitest harness (deleted after the run) running the unmodified `schedulePriceIngestions` against real local bindings via `wrangler.getPlatformProxy` over the same `.wrangler/state`, with `now` = the next daily boundary pass (2026-09-28T00:30Z) and a send-spy wrapping the real queue binding. Result: `enqueued 1/3`, exactly one message `{"dedupeKey":"price-ingestion-mydrink-2026-09-28-00","merchantId":"mydrink","sourceUrl":"https://mydrink.ee"}` (asserted). First run-2 attempt at 01:30Z (same day bucket) correctly enqueued 0 — boundary not crossed; the faithful second-run shape is the next boundary pass.
3. **Consumer handoff**: the running dev worker's queue consumer delivered the message itself (log: `Ingesting prices for merchant mydrink (dedupe key price-ingestion-mydrink-2026-09-28-00)` → `Handed off … to Workflow instance`) — no manual handoff needed.
4. **Run 2**: same harness, `now` = 2026-09-29T00:30Z → key `price-ingestion-mydrink-2026-09-29-00`; consumer handoff identical. Instance list after both runs: exactly **one instance per key, both `complete`**.

### Workflow results + idempotency evidence

| | Run 1 (`…2026-09-28-00`) | Run 2 (`…2026-09-29-00`) |
|---|---|---|
| Instance status | complete, ≈30 s | complete |
| `productsIngested` | **643** | **643** |
| Error lines | 771 (all unique) | 771 (all unique) |
| `retail_offers` mydrink | **643 rows / 643 products**, min 71 / max 175,026 c | 643 rows appended → **1,286 / 643 products**, exactly **2 `observed_at` batches** (14:50:21.702Z, 14:54:23.322Z = each run's fetch step) |
| `product_master` | 47 → **690 (+643**, exact) | **690 — unchanged** |

- Reconciliation both runs: 707 raw − 52 `no canonical beverage category` − 12 name/category disagreement (`wine_sparkling` name vs spirits categories) = **643** ✓ — the exact task-1.2 numbers. The remaining 707 error lines are one kept-without-EAN correction per row (every mydrink SKU is an internal code — the accepted D2 log noise). Error labels carry the shared parser's `alks product …` prefix (same accepted quirk kippis/longero recorded).
- **Compound-key idempotency holds**: run 2 matched all 643 of mydrink's own rows by (name, `''` brand, containerType, unitVolume) — zero new `product_master` rows, offers upserted as a fresh per-observation batch (row-count growth is the designed time-series shape; kippis 3.1 deviation note 4).
- **Parallel catalog (D4) confirmed**: all 643 offers sit on mydrink-created rows (+643 exact — zero compound matches against the pre-existing 47 seed rows; no EAN join, as the owner-confirmed no-EAN data implies).

### API verification (local worker, product **9022** `RARE LE CONTRASTE MILLESIME 1985 & MILLESIME 2015 12% 2x75CL`)

- Without `x-age-confirmed`: **403 `AGE_GATE_REQUIRED`** ✅.
- With header: mydrink offer — `merchant: "mydrink"`, `country: "EE"`, `priceCents: 175026`, `in_stock`, `sourceUrl: https://mydrink.ee/et/toode/rare-le-contraste-millesime-1985-millesime-2015-12-2x75cl/`, `reliabilityStatus: ESTIMATED`, `observedAt: 2026-09-27T14:54:23.322Z` (= run-2 fetch step) ✅.
- Merchant aggregate: **`mydrink offerCount 643`, freshestObservedAt = run-2 fetch step** ✅. Browse-path aggregates present (`merchantCount`, `lowestPriceCents`); ranked search serves mydrink-created products (`q=Trijol` → 13 results, first hit a mydrink-created row) ✅.
- Same read-model artifact as kippis 4.2/5.2: aggregate reports `governancePermissionStatus: "PENDING"` while the D1 row is `GRANTED` (the workflow gate honored the grant) — observation recorded, not investigated.

**Environment cleanup**: temporary harness file deleted; `/tmp` artifacts removed; `wrangler dev` stopped. No tracked file changed except this notes section.

## Task 4.2 — Staging rollout

Executed 2026-09-27, ~15:47–16:02 UTC. Staging D1 writes explicitly approved by the task (user-approved staging rollout). Worker context: the live staging api-worker is from the 4.1 merge — master `578036e` (PR #68 merged as 3a03fa0), Deploy Staging run **36330673942 GREEN** (polled from `in_progress` to `success` before any staging write). Nothing committed; only this notes section touched.

### Path decision (same blocker as kippis/longero 4.2)

The ops path (`POST /ops/console/merchants`, docs/ingestion-runbook.md §2.0) needs the staging `OPS_BEARER_TOKEN` Cloudflare secret — not present in any local env file. **Fell back to direct staging D1 via `wrangler d1 execute DB --remote --env staging`** (sanctioned by the task text): the same `audit_events` deviation as kippis/longero 4.2 — these two inserts have no audit entry; the console is the audited route; production 5.2 must use it or record the gap.

### Pre-checks (read-only, before any write)

- `merchant_registry`: exactly 4 rows — alko (id 1, empty feed URL, hourly), alks (id 2, DE, daily), longero (id 3, EE, daily), kippis (id 4, FI, daily). No mydrink anywhere.
- `source_governance`: exactly 3 rows — id 1 alks **`REVOKED`** (staging halt unchanged, `last_verified_at` still 2026-09-11T09:21:55.000Z), id 2 longero `GRANTED`, id 3 kippis `GRANTED`. STOP-condition clear.
- `retail_offers` mydrink: 0. Per-merchant baselines: alks 67,600 · longero 14,925/1,312 products · kippis 7,882/817 · 5 seed/test merchants 8–10 each (kippis/longero growth since their 4.2 is the designed per-observation accumulation).
- `product_master`: **4,346 rows, max id 4346** — the pre-ingest baseline (ingest-created products get ids > 4346).

### Writes (idempotent; verified by read-back)

- Registry (unique index makes re-runs no-ops): kippis-4.2 `INSERT … ON CONFLICT (merchant_id) DO NOTHING` with the task VALUES `('mydrink','MyDrink','EE','https://mydrink.ee','json',86400000)` — `changes: 1`, row **id 5**, values exact, created/updated 2026-09-27T15:50:24.050Z.
- Governance (no unique key — `NOT EXISTS` guard is the idempotency mechanism, kippis/longero pattern): guarded INSERT → `changes: 1`, row **id 4**, `RETAILER_API`/`GRANTED`, sourceUrl `https://mydrink.ee/wp-json/wc/store/v1/products`, reason "owner-operated site — documented scraping right (kippis/longero precedent); staging grant for first-ingest verification". **alks id 1 byte-identical before and after (still `REVOKED`)**; longero/kippis rows unchanged.

### First ingest via the Workflows REST API (kippis 4.2 method)

- Auth: wrangler's stored OAuth token → **0600 temp header file** under `/tmp/opencode` (never printed, **deleted** after the run); account id from `wrangler whoami --json` captured in the same invocation, never emitted.
- `POST /accounts/{account}/workflows/rajahinta-price-ingestion-staging/instances` body `{"id":"price-ingestion-mydrink-2026-09-27-15","params":{"merchantId":"mydrink","sourceUrl":"https://mydrink.ee","dedupeKey":"price-ingestion-mydrink-2026-09-27-15"}}` → `success: true`, internal uuid `d9f4fd9a-daff-49e8-9bab-876531a3af85`, `status: "queued"` at ~15:51Z, trigger `{source: 'api'}`. The `-<HH>` key cannot collide with the producer's daily key `price-ingestion-mydrink-2026-09-28-00` (mydrink is daily 86,400,000 ms; the boundary pass is 00:00 UTC).
- Polled via `GET …/instances/{uuid}` (the custom-id path form still 404s, per the kippis 4.2 tooling note): `running` 15:51:56Z → **`complete` 15:59:33Z (≈8 min)**, `error: null`.

### Workflow result

Output **`productsIngested: 643`** — the exact 1.2 sweep reconciliation: 707 raw − 52 `no canonical beverage category` − 12 name/category disagreement = **643** ✓. Error list **771 unique lines, identical to local 3.1**: 707 kept-without-EAN correction lines (one per raw row — every mydrink SKU is an internal code; accepted D2 noise), plus the 52 + 12 drop lines. Error labels carry the shared parser's `alks product …` prefix (same accepted quirk as kippis/longero). No `waiting` park, no step retries — 643 products stay well under the invocation subrequest budget.

### Verification

- **`retail_offers`**: **643 mydrink rows over 643 distinct products**, min 71 / max 175,026 cents (max = `RARE LE CONTRASTE MILLESIME 1985 & MILLESIME 2015 12% 2x75CL` on product 4366 — a real 3-l BIB case price, same item as local 3.1's sample), single value set EUR / EE / `in_stock` / `ESTIMATED`, single `observed_at` 2026-09-27T15:51:54.827Z (= fetch step). No other merchant changed (post-run per-merchant counts identical to baseline).
- **`product_master`**: 4,346 → **4,983 (+637 mydrink-created rows**, zero EANs on them — owner-confirmed no-EAN data).
- **Parallel catalog + first compound-tier joins (D4)**: 637 of 643 mydrink products formed their own catalog rows. **6 offers compound-matched pre-existing (kippis-created) rows** — impossible locally (47-row seed master), but staging's richer catalog lets the compound tier fire: `EL MATADOR BLANCO 11% 1L TETRA` (3560), `EL MATADOR TINTO 11% 1L TETRA` (3561), `NORMINDIA GIN 41,4% 70CL` (3571) — EAN-populated rows — plus three EAN-less 300cl BIB rows (4104/4106/4115). Each now carries an FI kippis + EE mydrink offer pair — the cross-border same-product case the compound tier exists for. The merge-path "own catalog rows" expectation holds for the catalog at large (637/643); the 6 joins are designed behavior, recorded as the actual.
- **API** (`https://rajahinta-api-staging.siim-liimand.workers.dev`, product **3560** `EL MATADOR BLANCO 11% 1L TETRA` — chosen because it compound-joined a pre-existing row with a live kippis offer):
  - Negative control: `GET /api/v1/products/3560` without header → **HTTP 403 `AGE_GATE_REQUIRED`** ✅.
  - With `x-age-confirmed: confirmed` → HTTP 200 with a **cross-border offer pair**: `kippis` (FI) · **`mydrink` EE 619¢** — EUR / `in_stock` / `ESTIMATED`; mydrink `sourceUrl: https://mydrink.ee/et/toode/el-matador-blanco-11-1l-tetra/`, `observedAt: 2026-09-27T15:51:54.827Z` (= fetch step) ✅.
  - Merchant aggregate (`merchantReliability`): **`mydrink` offerCount 643, all ESTIMATED, freshestObservedAt = fetch step** ✅.
  - Known read-model artifact (kippis 4.2/5.2 + local 3.1 precedent, recorded not chased): the aggregate reports `governancePermissionStatus: "PENDING"` while the D1 row is `GRANTED` (the workflow gate honored it).

### Post-checks

- `source_governance` final: 4 rows — alks **`REVOKED` unchanged**, longero/kippis `GRANTED` unchanged, mydrink `GRANTED` (new id 4, exactly one mydrink row). **Kippis's staging halt on alks was not lifted.**
- Registry final: 5 rows, only mydrink added. Production untouched throughout; no redeploys.

### Commands executed (names)

`npx wrangler d1 execute DB --remote --env staging --json --command "<read-only pre-check probes>"` (registry · governance · per-merchant offer counts · product_master count/max-id · mydrink offers) · same with the two `INSERT` statements · same for read-backs, post-checks, and verification queries · `npx wrangler whoami --json` (account id into a same-invocation shell var, never emitted; OAuth token → 0600 temp header file under `/tmp/opencode`, never printed, deleted after the run) · `curl -X POST /accounts/{account}/workflows/rajahinta-price-ingestion-staging/instances` · `curl …/instances/d9f4fd9a-…` (status + output polls, 30 s interval) · `curl /api/v1/products/3560` ± `x-age-confirmed: confirmed`.

### Deviations / notes vs the kippis 4.2 playbook

1. Same ops-path blocker and same sanctioned fallback (direct D1; `OPS_BEARER_TOKEN` absent locally) → same `audit_events` deviation for the lead.
2. **First recorded mydrink compound-tier joins: 6/643 (0.9%)** onto kippis-created same-name rows — local 3.1 had zero (its master held only 47 seed rows). Pure addition to the parallel-catalog picture; no conflict with the merge-path facts.
3. Read-model `governancePermissionStatus: "PENDING"` in the merchant aggregate despite the `GRANTED` D1 row — recurring artifact, unchanged.
4. REST POST succeeded first attempt (same-invocation account-id capture; the kippis 4.2 empty-`{account}` mis-route did not recur).
5. The producer's first real mydrink pass is the 2026-09-28T00:00Z boundary (expected key `price-ingestion-mydrink-2026-09-28-00`, exactly one enqueue/instance) — observation deliberately NOT blocking this task; 6.1 owns it.

## Task 5.2 — Production rollout

Executed 2026-09-27, ~16:19–16:34 UTC, with the user's explicit production-rollout approval. Production context: master `95d5a17` deployed by this change's 5.1 (run **36332653409**, health gate green, `api.rajahinta.fi` healthy). Nothing committed; only this notes section touched.

### Path decision (same blocker as kippis/longero 5.2 and mydrink 4.2)

The audited ops path (`POST /ops/console/merchants`, docs/ingestion-runbook.md §2.0) needs the production `OPS_BEARER_TOKEN` Cloudflare secret — absent from every local env file (checked by variable NAME only; values never printed). **Fell back to direct production D1 via `wrangler d1 execute DB --remote --env production`** (sanctioned by the task text), i.e. the same `audit_events` deviation as kippis/longero 5.2 and mydrink 4.2: **these two inserts have no `audit_events` entry — the console is the audited route; the lead should backfill or accept the gap.**

### Pre-checks (read-only, before any write)

- `merchant_registry`: exactly 3 rows — id 1 alks (DE, daily), id 2 longero (EE, daily), id 3 kippis (FI, daily). No mydrink row. STOP-condition clear.
- `source_governance`: exactly 3 rows — ids 1–3, all `GRANTED`. STOP-condition clear.
- `retail_offers` baselines: alks 37,364 / 2,829 products · kippis 7,882 / 635 · longero 13,303 / 980 · **mydrink 0**.
- `product_master`: **3,775 rows, max id 3775** (3,145 with EAN) — the pre-ingest baseline (ingest-created products get ids > 3775).

### Writes (idempotent; verified by read-back)

- Registry (unique index makes re-runs no-ops): the 4.2 `INSERT … VALUES ('mydrink','MyDrink','EE','https://mydrink.ee','json',86400000) ON CONFLICT (merchant_id) DO NOTHING` — `changes: 1`, row **id 4**, created/updated 2026-09-27T16:23:27.254Z, values exactly per task/D5 spec.
- Governance (no unique key — `NOT EXISTS` guard is the idempotency mechanism, kippis/longero pattern): guarded INSERT → `changes: 1`, row **id 4**, `RETAILER_API`/`GRANTED`, sourceUrl `https://mydrink.ee/wp-json/wc/store/v1/products`, reason "owner-operated site — documented scraping right (kippis/longero precedent); production grant for first-ingest verification", last_verified_at 2026-09-27T16:23:36.921Z.
- **alks/longero/kippis unchanged: YES** — full-table dumps of both tables before vs after diffed: every non-mydrink registry and governance row **byte-identical** (all columns, timestamps included); exactly 1 row added per table.

### First ingest via the Workflows REST API (kippis 5.2 / mydrink 4.2 method)

- Auth: wrangler's stored OAuth token → **0600 temp header file** under `/tmp/opencode` (value never printed; account id from `wrangler whoami --json` captured **in the same invocation as the POST** — the kippis 4.2 empty-`{account}` lesson; never emitted; file **deleted** after the run).
- `POST /accounts/{account}/workflows/rajahinta-price-ingestion-production/instances` body `{"id":"price-ingestion-mydrink-2026-09-27-16","params":{"merchantId":"mydrink","sourceUrl":"https://mydrink.ee","dedupeKey":"price-ingestion-mydrink-2026-09-27-16"}}` → `success: true`, internal uuid **`b238de93-774c-4b34-9be7-66bcaf9f6ed0`**, `status: "queued"`, trigger `{source: 'api'}` — first attempt, no mis-route. The `-16` hour key cannot collide with the producer's daily key `price-ingestion-mydrink-2026-09-28-00`.
- Polled via `GET …/instances/{uuid}` (the custom-id path form still 404s, per the 4.2 tooling note): `running` 16:25:30Z → **`complete` 16:31:38Z (≈7 min)**, `success: true`, `error: null`. **No `waiting` park, no step retries** — the 4.2 good shape (643 products stay well under the invocation subrequest budget).

### Workflow result

Output **`productsIngested: 643`** — the exact 1.2 sweep reconciliation: 707 raw − 52 `no canonical beverage category` − 12 name/category disagreement = **643** ✓. Error list **771 unique lines, identical to local 3.1 and staging 4.2**: 707 kept-without-EAN correction lines (one per raw row — every mydrink SKU is an internal code; accepted D2 noise) plus the 52 + 12 drop lines. Error labels carry the shared parser's `alks product …` prefix (same accepted quirk as kippis/longero).

### Verification

- **`retail_offers`**: **643 mydrink rows over 643 distinct products** (expected ~643), min 71 / max 175,026 cents (max = `RARE LE CONTRASTE MILLESIME 1985 & MILLESIME 2015 12% 2x75CL` — the same 3-l BIB case-price item as staging/local), single value set EUR / EE / `in_stock` / `ESTIMATED`, single `observed_at` **2026-09-27T16:25:20.648Z** (= fetch step). **No other merchant changed** — post-run per-merchant counts identical to baseline (alks 37,364 · kippis 7,882 · longero 13,303).
- **`product_master`**: 3,775 → **4,412 (+637 mydrink-created rows**, zero EANs on them — owner-confirmed no-EAN data).
- **Parallel catalog + compound-tier joins (D4)**: **637 of 643 mydrink products formed their own catalog rows; 6 offers compound-matched pre-existing rows (6/643 = 0.9% — the same six items as staging 4.2)**: `EL MATADOR BLANCO 11% 1L TETRA` (**3514**), `EL MATADOR TINTO 11% 1L TETRA` (3515), `NORMINDIA GIN 41,4% 70CL` (3525) — EAN-populated rows — plus EAN-less 300cl BIB rows 3697 (`Barone Montalto Passivento`), 3698 (`J.P.Chenet Merlot`), 3704 (`Stony Cape Chenin Blanc`). Each joined row now carries an FI + EE cross-border offer pair. The compound tier is production-proven; the merge-path "own catalog rows" expectation holds for the catalog at large.
- **Public API** (`https://api.rajahinta.fi`, product **3514** — chosen because it compound-joined a pre-existing row with a live kippis offer):
  - Negative control: `GET /api/v1/products/3514` without header → **HTTP 403 `AGE_GATE_REQUIRED`** ✅.
  - With `x-age-confirmed: confirmed` → HTTP 200 with a **cross-border offer pair**: `kippis` FI 654¢ (`observedAt` 2026-09-27T00:00:51.494Z — today's 00:00 UTC boundary run) · **`mydrink` EE 619¢** — both EUR / `in_stock` / `ESTIMATED`; mydrink `sourceUrl: https://mydrink.ee/et/toode/el-matador-blanco-11-1l-tetra/`, `observedAt: 2026-09-27T16:25:20.648Z` (= fetch step) ✅.
  - Merchant aggregate: **`mydrink` offerCount 643, all ESTIMATED, freshestObservedAt = fetch step** ✅. Known read-model artifact (kippis 4.2/5.2 + local 3.1 + staging 4.2 precedent, recorded not chased): the aggregate reports `governancePermissionStatus: "PENDING"` while the D1 row is `GRANTED` (the workflow gate honored it).
- **Public product page** (`https://rajahinta.fi/products/3514`, HTTP 200): the server-rendered HTML contains the mydrink offer table row (row key 90343): `mydrink`, **6.19 €**, outbound-link CTA — the page serves mydrink items without client fetches (kippis 5.2 method; crawlable-soft-gate rule satisfied).
- **Readiness post-ingest**: `GET /api/v1/health/ready` → HTTP 200 (`d1` up, `durableObjects` up); frontend `https://rajahinta.fi/` → HTTP 200.

### Commands executed (names)

`npx wrangler d1 execute DB --remote --env production --json --command "<read-only pre-check probes>"` (registry · governance full dumps · per-merchant offer counts · product_master count/max-id/EAN count · mydrink offers) · same with the two `INSERT` statements · same for read-backs, byte-identity re-dumps, and verification queries (offer stats · value sets · join split · joined-product names) · `npx wrangler whoami --json` (account id into a same-invocation shell variable, never emitted; OAuth token → 0600 temp header file under `/tmp/opencode`, value never printed, file deleted after the run) · `curl -X POST /accounts/{account}/workflows/rajahinta-price-ingestion-production/instances` · `curl …/instances/b238de93-…` (status poll loop → terminal, then output poll) · `curl /api/v1/products/3514` ± `x-age-confirmed: confirmed` · `curl https://rajahinta.fi/products/3514` · `curl /api/v1/health/ready` · `curl https://rajahinta.fi/`.

### Deviations / notes vs the kippis 5.2 playbook

1. **`audit_events` deviation (explicit, for the lead)**: the two production mydrink rows were inserted via direct D1, not the ops console — no `audit_events` entries exist for them. The console token (`OPS_BEARER_TOKEN`) is unavailable locally; identical deviation to kippis/longero 5.2 and mydrink 4.2. Backfill or accept.
2. Read-model artifact (out of scope, recurring): merchant aggregate reports mydrink `governancePermissionStatus: "PENDING"` while the D1 `source_governance` row is `GRANTED` and the workflow gate honored it. Not investigated.
3. Compound-tier joins present in production on day one (6/643, the same six items as staging) — production's pre-existing master (alks DE 2,829 + kippis FI 635 + longero EE 980 products) contains the same-name rows; local 3.1 had zero only because its master held 47 seed rows.
4. Production D1 writes were exactly the two mydrink rows; alks/longero/kippis rows untouched (byte-identity diffed); no redeploys; nothing committed.
5. Workflow trigger and run clean on first attempt — no `waiting` park, no step retries, no mis-routed POST.

### FOLLOW-UP CHECKLIST — next scheduled boundary 2026-09-28 00:00 UTC

The manual instance above is trigger `api` with an hour-suffixed id; the producer's first real mydrink pass is the daily tick at/after the boundary (mydrink is daily 86,400,000 ms — interval-bucket gate fires on the 00:00 UTC pass). Verify at/after the boundary (task 6.1 references this checklist):

- [ ] **Exactly one `mydrink` enqueue** from the producer tick: one queue message with dedupe key **`price-ingestion-mydrink-2026-09-28-00`** (kippis's `price-ingestion-kippis-2026-09-28-00` and longero's `price-ingestion-longero-2026-09-28-00` are separate, expected second/third messages — the multi-daily-merchant shape kippis 3.1 proved).
- [ ] **Exactly one new mydrink workflow instance** in `rajahinta-price-ingestion-production`, id `price-ingestion-mydrink-2026-09-28-00` — no duplicate instances; the manual `-16` instance above must NOT re-run.
- [ ] **Offers refreshed**: mydrink rows re-upserted at a fresh `observed_at` batch ≈ the boundary (offer rows are per-observation — expect row-count growth from 643 toward ~1,286, per 3.1 deviation note 4); alks/kippis/longero offer rows untouched by the mydrink run.
- [ ] Check commands: `npx wrangler tail --env production` on the api-worker across the tick (enqueue + `Handed off ingestion … price-ingestion-mydrink-2026-09-28-00` lines) or the Workers logs dashboard · `GET /accounts/{account}/workflows/rajahinta-price-ingestion-production/instances` (auth: 0600 temp header file from wrangler's stored OAuth token, deleted after) for the single-instance check · read-only `npx wrangler d1 execute DB --remote --env production --json --command "SELECT observed_at, COUNT(*) FROM retail_offers WHERE merchant='mydrink' GROUP BY observed_at ORDER BY observed_at"` for the refresh check.
- [ ] Recorded 2026-09-27 ~16:34 UTC, ~7.5 h before the boundary — observation of the boundary is deliberately NOT blocking this task.

## Task 6.1 — Verification

Executed 2026-09-27 on `master` @ `994938d` (clean tree). Read-only sweep: local suite runs only — zero staging/production contact (the rollout evidence is referenced from 4.2/5.2, not redone). Command list mirrors the previous change's verification (archive `2026-09-27-client-experience-improvement`, task 6.1; kippis archive 2026-09-26 as second reference). `@rajahinta/core-domain` rebuilt first — the 1.2/3.1 stale-`dist` lesson (downstream suites resolve the mapper vocabulary through dist). Nothing committed; only this notes section touched.

### Sweep results (all commands pass, exit 0)

| Command | Result |
|---|---|
| `pnpm --filter @rajahinta/core-domain build` | ✅ pass (task-required first step, tsc clean) |
| `pnpm run typecheck` | ✅ pass — all 8 workspace projects `Done` (core-domain, data-platform, data-acquisition, application-api, backend, api-worker, frontend, email-worker) |
| `pnpm run lint` (`eslint .`) | ✅ pass — 0 errors; 4 pre-existing warnings, all `no-explicit-any` in an untracked `.kilo/` worktree tooling file, zero findings in tracked source |
| `pnpm run lint:content` | ✅ pass — frontend `lint-content-policy.ts` clean |
| `pnpm run test` (unit suites) | ✅ pass — **5,177 passed / 3 skipped / 0 failed** in 361 files: core-domain 1,427 · frontend 970 · api-worker 968 · data-platform 673 · data-acquisition 309 · application-api 728 (+3 skipped of 731 — DB-gated, `TEST_DATABASE_URL` not set, same as CI's non-Postgres path) · email-worker 83 · backend 19 |
| `pnpm run test:e2e` | ✅ pass — 1 file, 15 tests |
| `pnpm run test:d1` | ✅ pass — 14 files, 148 tests |

No failures anywhere; nothing fixed, nothing rerun. The application-api skips are pre-existing, CI-identical design skips. The broader CI matrix beyond these seven commands ran green on this change's merge commits (4.1/5.1 deploy runs health-gated; staging run 36330673942, production run 36332653409).

### Evidence inventory (recorded by earlier tasks — referenced, not redone)

| Evidence | Task | Fact |
|---|---|---|
| Staging API serving the mydrink catalog | 4.2 | product 3560: HTTP 403 `AGE_GATE_REQUIRED` without header; with `x-age-confirmed` a cross-border offer pair (kippis FI + mydrink EE 619¢, EUR / in_stock / ESTIMATED); merchant aggregate **mydrink offerCount 643** |
| Production API + product page serving the mydrink catalog | 5.2 | `api.rajahinta.fi` product 3514: 403 without header; with header the kippis FI 654¢ + mydrink EE 619¢ pair; `https://rajahinta.fi/products/3514` HTTP 200 with the mydrink 6.19 € offer row server-rendered; readiness green post-ingest |
| Compound-key idempotency across local runs 1→2 | 3.1 | `product_master` 47 → 690 (run 1), **690 unchanged** (run 2) — all 643 rows matched on (name, `''` brand, containerType, unitVolume); offers re-upserted as a fresh per-observation batch (exactly 2 `observed_at` batches) |
| Production first ingest complete | 5.2 | instance `b238de93-…` `complete` ≈7 min, **`productsIngested: 643`** = the exact 1.2 reconciliation (707 − 52 − 12); 771 unique error lines identical across local 3.1 / staging 4.2 / production 5.2 |

### Daily-single-enqueue at the 2026-09-28T00:00:00Z boundary — **PENDING** (the change's single open verification item)

NOT yet observable: the first scheduled boundary after onboarding is **2026-09-28T00:00:00Z — after this session**. Recorded as pending; nothing extrapolated. What exists pre-boundary:

- **Producer unit suite** (passing in the api-worker 968): `intervalBucketFires` — *"fires a daily merchant exactly once across 24 consecutive hourly ticks — the first tick at/after 00:00 UTC"*; `schedulePriceIngestions` cadence gate — daily merchants enqueue once per day.
- **Local 3.1 harness**: the daily interval-bucket gate produced exactly one message keyed `price-ingestion-mydrink-2026-09-28-00`, and a same-day repeat tick correctly enqueued 0; the next-boundary pass produced exactly `price-ingestion-mydrink-2026-09-29-00` — one enqueue per key, zero duplicates.

Observe at/after the boundary per the **5.2 FOLLOW-UP CHECKLIST** (this section references it):

1. **Exactly one mydrink enqueue** — one queue message with dedupe key **`price-ingestion-mydrink-2026-09-28-00`** (kippis/longero daily keys are separate, expected messages).
2. **Exactly one new workflow instance** `price-ingestion-mydrink-2026-09-28-00` in `rajahinta-price-ingestion-production` — no duplicates; the manual `-16` instance must NOT re-run.
3. **New observed_at batch** ≈ the boundary (row-count growth 643 → ~1,286 expected, per 3.1 deviation note 4); other merchants untouched by the mydrink run.

Check commands (from the 5.2 checklist): `npx wrangler tail --env production` across the tick (or the Workers logs dashboard) · `GET /accounts/{account}/workflows/rajahinta-price-ingestion-production/instances` (auth: 0600 temp header file from wrangler's stored OAuth token, deleted after) · read-only `npx wrangler d1 execute DB --remote --env production --json --command "SELECT observed_at, COUNT(*) FROM retail_offers WHERE merchant='mydrink' GROUP BY observed_at ORDER BY observed_at"`.

**Result**: sweep fully green on the task's seven command categories; catalog-serving and compound-key idempotency evidenced from 4.2 / 5.2 / 3.1. The 2026-09-28T00:00Z production enqueue observation is the only item blocking full change closure; everything else in 6.1 is complete and green.

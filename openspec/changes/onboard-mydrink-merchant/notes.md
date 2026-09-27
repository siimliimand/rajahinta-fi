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

(recorded by the implementing agent)

## Task 5.2 — Production rollout

(recorded by the implementing agent)

## Task 6.1 — Verification

(recorded by the implementing agent)

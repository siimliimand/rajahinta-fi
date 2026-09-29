# Onboard mydrink merchant

## Why

The catalog ingests four live sources today: the Alko domestic reference feed and three WooCommerce Store API adapters (alks/DE, longero/EE, kippis/FI). MyDrink (mydrink.ee) grants documented scraping rights to its public WooCommerce Store API (`https://mydrink.ee/wp-json/wc/store/v1/products`, 707 products), making it the fifth live source and the second Estonian retailer beside longero. The owner operates the WordPress install and confirmed the catalog carries no EAN data, so the onboarding proceeds EAN-less by decision, not by omission.

A full-catalog sweep (task 1.1, `scripts/mydrink-catalog-sweep.ts`, 707/707 rows, zero page failures) shows the established Store API shape: EUR minor-unit prices with the effective (sale) price in `prices.price`, all rows `type: simple`, `X-WP-TotalPages` pagination, name-embedded ABV/volume with comma decimals (`4,5% vol 1L PET`), and a populated `weight` field in kg. Two measured gaps gate the work:

- **Category vocabulary (443 rows dropped, 62.7%).** MyDrink's storefront categories are Estonian (`Kange alkohol ▾`, `Veinid ▾` with leaves `Punased`/`Valged`/`Pakiveinid`/`Vahuveinid`/`Shampanjad`, `Õlu ▾`, `Siider`, `Liköör`, `Konjak`, `Vodka`, `Viski`, `Rumm`), which exact-match in `mapSourceCategory` misses today. The parsed 263 rows got through on name tokens alone.
- **SKU/EAN gap (707 of 707 SKUs "other").** Every SKU is an internal code (`MTBE026-1-2-1` shape); the `brands` array is empty on every row. Records therefore ingest EAN-less and brand-less by design: the upsert's compound tier (name + brand + containerType + unitVolume) makes repeat runs idempotent, and MyDrink forms its own catalog products — the accepted parallel-catalog behavior of alks and longero, here confirmed with the owner.

## What Changes

### Sweep before wiring (done)

- The read-only sweep walked the whole catalog through the production parser and measured the drop taxonomy, the Estonian category census (70 distinct terms), the SKU/EAN gap, brand coverage, and the product-type census. Findings scope the vocabulary list below; the sweep re-runs after the mapping change to measure the new drop rate.

### Additive category vocabulary

- `SWEDISH_SOURCE_CATEGORY_MAP` gains the MyDrink terms as additive exact keys, each to an existing canonical category: the spirits section parent `kange alkohol ▾` plus its leaves (`vodka`, `viski`, `konjak`, `rumm`, `gin` → spirits; `liköör` → liqueur); the wine leaves only — `punased`/`valged`/`pakiveinid` → wine, `vahuveinid`/`shampanjad` → sparkling-wine; `õlu ▾` → beer; `siider` → cider; `alkoholivaba ▾` and `karastusjoogid` → non-alcoholic.
- The wine parent `veinid ▾` stays unmapped: `categoryImpliedMapping` takes the first mappable term in payload order, so mapping the parent would misfile sparkling rows as still — a wrong excise key. Sparkling resolves only from its own leaf terms. Heterogeneous or decorative terms (`☝️ Lahja alkohol`, `☝️ Kange`, `Kokteilijoogid`, `Kingiideed ▾`, `Avaleht`, `Pandipakend`, country names) stay unmapped and land in the correction queue rather than guessing a tax category.

### Adapter + wiring

- `MydrinkFeedAdapter` (`merchantId: 'mydrink'`) becomes a thin subclass of the shared `WooStoreFeedAdapter` walk — no shared-code change (the rule-of-three extraction happened at kippis). Registered in both composition sites and exported from the package index; composition tests assert five live adapters resolve by merchantId.
- No parser change. All 707 SKUs stay EAN-less with a per-row correction error (no fabricated EANs); the 1.1% ESTIMATED share (unparsed ABV) is the parser's existing keyed-uncertainty path.

### Progressive rollout: local → staging → production

- **Local**: registry row (`mydrink`, country `EE`, json, daily) plus a `RETAILER_API`/`GRANTED` governance record in local D1; producer + workflow run end-to-end locally against the live feed (read-only GETs); compound-key merge verified on a second run.
- **Staging**: PR merge auto-deploys the worker; registry + governance granted; first ingest verified via a manual Workflow instance.
- **Production**: gated deploy, registry + governance granted, first ingest verified, first scheduled 00:00 UTC enqueue observed once.

## Non-goals (this change)

- No EAN or brand recovery from names, image filenames, or meta fields — the owner confirmed no EAN data exists; records stay EAN-less and brand-empty.
- No cocktail (`Kokteilijoogid`, `Kokteil`) or gift-category mapping — RTD cocktails carry a genuinely ambiguous tax category; unmapped rows are the correction queue's input, never a guessed assignment.
- No upsert matching relaxation (no fuzzy or name-only cross-merchant joins).
- No frontend changes — mydrink products flow through the existing catalog, product pages, and search unchanged.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `data-acquisition`: Permitted-source ingestion gains mydrink as the fifth live adapter (registry row, `RETAILER_API` governance, daily cadence); the Store API adapter registry counts five merchants. SKU/EAN rules unchanged — non-matching SKUs keep the record EAN-less and correction-flagged.

## Impact

- `packages/core-domain` (category mapper vocabulary), `packages/data-acquisition` (new mydrink adapter), `apps/api-worker` (two adapter-map composition sites), `scripts/mydrink-catalog-sweep.ts` (done, re-run for verification).
- Data: `merchant_registry` + `source_governance` rows per environment (local, staging, production). No schema migrations; `retail_offers`/`product_master` gain rows only through the normal upsert path.
- No frontend, API-contract, or dependency changes.

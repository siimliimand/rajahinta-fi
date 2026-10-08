# Onboard Shopify and LMDW merchants — Design

## Context

Six merchants ingest through the governed pipeline: the Alko domestic reference feed plus five store-API adapters sharing the `WooStoreFeedAdapter` walk and `parseAlksStoreProducts` parser. The walk's discipline (sequential pages, header-capped bound, per-page failures collected never thrown) and the parser's discipline (keyed-uncertainty ESTIMATED path, EAN-only-from-accepted-SKU-shapes, category from categories-first with a contradiction gate) are the contracts every new feed must honor.

The wave brings three stores on two new protocols. Read-only probe measurements (2026-10-07, this host):

| | bottleofitaly.com | kuhns.shop | gateway.prod2.whisky.fr |
|---|---|---|---|
| Platform | Shopify | Shopify | Magento 2 GraphQL (LMDW) |
| Currency | EUR (cart.js) | EUR (cart.js) | EUR (`price_range` per item) |
| Catalog size | ≥250 (page 1 full at `limit=250`) | TBD (sweep) | 3,213 via `category_id: "3"` filter |
| ABV | `custom-gradazione-40-0` tag, 100 % of page 1 | title `alc. 12 Vol.-%` | `short_description.html` `à 45% alc.` / `52%` / `45,8%` |
| Volume | title (98/250 = 39 %) | title `0,75l` comma decimal | **not located** |
| Weight | `grams` 100 % | `grams` present | not seen |
| EAN/barcode | 0 barcodes on sample | SKU `ML9500` | SKU numeric (`66250`) |
| Category input | `product_type` EN (`Spirits`, `Vino Rosso`, `Olio` 90/250, `Aceto` 12/250) | `product_type` DE (`Wein`) | `m3_family` (`rhum`, `whisky`), `m3_division: liquide` |
| Rate-limit behavior | Shopify 429 after ~6 rapid requests | Shopify 429 observed | none observed (French error messages) |

The live `nonalcoholic-catalog-hygiene` rule holds alcohol-category rows with parsed ABV = 0 or null out of user-facing surfaces. The upsert port matches by EAN first, compound key second, insert third — with no EANs anywhere in these catalogs, repeat runs converge on the compound tier.

## Goals / Non-Goals

**Goals:**

- Three new live sources on the daily cadence through the unchanged governance gate (register → auto-grant → hourly producer).
- The Shopify walk shared from merchant one of two — the products.json shape is platform-fixed, so the walk is genuinely common while parsing stays per-merchant.
- The repo's first GraphQL adapter established with the same walk discipline (bounded, sequential, per-page failure isolation).
- Sweep-first per merchant: extraction is proven read-only before any adapter lands.

**Non-Goals:**

- EAN/brand inference, upsert matching relaxation, correction-queue remediation.
- Storefront API migration, LMDW `custom_attributesV2` debugging, `compare_at_price` semantics.
- Parser unification across the two Shopify stores beyond the shared walk.
- Frontend or API-contract changes.

## Decisions

### D1 — Shared `ShopifyProductsFeedAdapter` walk at two merchants

`shopify-products.walk.ts` mirrors the `WooStoreFeedAdapter` shape: abstract `merchantId`, a per-merchant error-label prefix, collection URL appended to the trailing-slash-stripped registry `feedUrl`, sequential pages, per-page failures accumulated in `errors[]` and never thrown. One documented divergence: Shopify `products.json` exposes **no total-pages header**, so the bound is **short-page termination** — a page returning fewer products than `limit=250` is the last page, and an empty page is normal termination (not an error). This is weaker than `X-WP-TotalPages` (a catalog changing size mid-walk can extend or truncate the walk by one page) — accepted because the products.json format is Shopify-fixed and stable, the same argument that justified the Woo walk at three. Alternative — duplicate the walk twice and extract at a third Shopify merchant — rejected: the platform-format argument is stronger than the rule-of-three formality, and the walk is the *only* shared piece (parsers stay per-merchant).

### D2 — Per-merchant parsers, sweep-proven extraction promoted

BOI (`bottleofitaly.parser.ts`): ABV from the `custom-gradazione-XX-X` tag (integer + decimal-halves form, e.g. `40-0` → 0.40; `41-5` → 0.415), volume from the title first (`20cl`, `70cl`, `0,75 l` tokens) with the sweep-decided fallback for the 61 % the title misses (variant title / description / honest `0 ml` + ESTIMATED). kuhns (`kuhns.parser.ts`): German title patterns — `alc. 12 Vol.-%` (ABV), `0,75l` comma-decimal volume, `0,2l`/`1L` forms, multipack tokens if the census shows them. Both promote the logic their sweep script prototyped, so the parser is never the first time the extraction runs. Rows whose ABV or volume cannot be parsed ingest through the keyed-uncertainty ESTIMATED path — never guessed, never dropped. `compare_at_price` is unread (marketing "was" price, not the platform's original-price provenance). Vendor → manufacturer and brand (both stores' `vendor` is the brand); `grams` → `weightGrams`; availability from the variant `available` flag.

### D3 — Category vocabulary: additive exact keys from the three censuses

`SWEDISH_SOURCE_CATEGORY_MAP` gains exact-match keys per the sweep censuses — BOI `product_type` (EN), kuhns `product_type` (DE), LMDW `m3_family` (FR) — each to an existing canonical category. Deliberately unmapped: `Olio`, `Aceto`, and any non-beverage merch term the censuses surface (correction queue, never a guessed tax key — the mydrink merch precedent). The sweeps re-run after the vocabulary lands to measure the new drop rate. The LMDW m3 taxonomy is the cleanest category input the platform has seen (single low-cardinality structured value) — it replaces parsing French category names. **Sweep correction (1.1/1.2)**: BOI's merch share is 2.6 % catalog-wide (the ~36 % was page-1 skew), and kuhns leaves `product_type` empty on 93.7 % of rows — the DE keys cover only its typed minority; untyped kuhns rows classify through the established parser name-token fallback (categories-first, name-tokens-second, contradiction gate), so task 3.2's parser carries the title-inference weight for that store.

### D4 — LMDW GraphQL walk: mandatory filter, `total_count` bound, sku dedupe — **SPIKED, NOT BUILT**

The gateway rejects filter-less `products` queries, so the walk filters `category_id: "3"` (Nature de produit; the spike measured the live catalog at 6,821 total_count / 6,814 distinct SKUs across 69 pages) and pages `currentPage: 1..N` at `pageSize ≤ 100` until collected equals `total_count`, deduping by `sku`. Field selection per request: `sku`, `name`, `price_range { minimum_price { final_price { currency value } } }`, `stock_status`, `short_description { html }`, `m3_family { label }`. EUR minor-unit conversion of `final_price.value` is exact to cents; a non-EUR currency row is a per-row correction error (Posti precedent) — no conversion path is added. `stock_status: IN_STOCK`/`OUT_OF_STOCK` → availability. `depositSystem: false` always — French deposits are not Finnish pantti. **Outcome (task 1.3)**: the design was spiked end-to-end and returned NO-GO (D5) — this section remains the decision record and the starting point for the follow-up crawl-pattern change; no adapter code was built against it.

### D5 — The spike gates the LMDW adapter (live hold-rule interplay) — **RESOLVED: NO-GO**

Task 1.3 ran as the decision task and measured: feed-side ABV coverage **10.3 %** (699/6,814, guarded pattern — the unguarded pattern's extra matches were `"100% agave"` artifacts), volume sources at `lmdw_label` 0 % / name suffixes 2.6 % / packaging category 3.8 % cross-ref only, and a full `ProductInterface` introspection (76 fields, no ABV/volume field; `custom_attributesV2` internal-errors). The only measured full-coverage source is the product-page HTML (`"volume"` litres + `"strength"` in embedded state JSON, 10/10 sampled pages) — crawl-scale, not a GraphQL field. **Decision: NO-GO** (the design's accepted third outcome): ~90 % of the catalog would hygiene-hold under the live rule, and building the GraphQL adapter anyway ships shelfware. LMDW defers to a named follow-up change onboarding it as a sitemap-crawl merchant (product-page pattern), taking the registry row and FR `m3_family` vocabulary with it. The Shopify pair proceeds.

### D6 — Workers-egress smoke at staging before production trust

Posti's price-list endpoint blocks Cloudflare egress (403/1031) — every probe in this plan ran from this host, not a Workers runtime. Staging task 6.2 therefore records, per source, the first fetch results *from the deployed Worker* before any production registration. A blocked source follows the Posti playbook (curated/manual path or CDN negotiation), not a silent retry loop.

### D7 — Rate-limit politeness is a walk property, not an ops hope

Both Shopify stores 429'd a polite prober within ~6 rapid requests. The shared walk keeps requests sequential (one page in flight), `limit=250` (fewest requests), and treats a 429 page as a collected per-page failure — the run persists what succeeded and reports the rest, so a throttled daily run degrades instead of hammering. No retry/backoff machinery in this change: the daily cadence makes the next run the retry, and adding backoff is a measured follow-up if sweeps or staging show persistent 429s.

### D8 — Registry, merchantIds, and the correction-noise budget

Registry rows (alks pattern, post-re-scope ×2): `('bottleofitaly', 'Bottle of Italy', 'IT', 'https://bottleofitaly.com', 'json', 86_400_000)` and `('kuhns', 'Kuhns', 'DE', 'https://kuhns.shop', 'json', 86_400_000)` — the originally planned `lmdw` row is removed by the NO-GO re-scope and lands with the LMDW follow-up change (a registry row without an adapter would be a dormant trap). Governance `acquisitionMethod: RETAILER_API` for all three (public store-API pattern; source URLs recorded per grant). EAN-less ingestion produces one correction line per row per run — **sweep-measured reality (1.1/1.2)**: the BOI catalog is 22,937 products (14× the ~1,630-line budget D8 originally assumed from araxes; that number came from a smaller store) and kuhns is 2,012 — the correction-log volume is accepted with eyes open, and a registry-level drop-category filter for the merchant is the named follow-up if the noise proves operationally expensive (a registry/config decision, not a parser guess). The BOI merch share is 2.6 % catalog-wide (601 rows) — small, but it still lands as review input by design.

## Risks

- **Shopify kills `page`-param pagination** (it is formally deprecated): the walk breaks loudly (empty pages terminate the walk immediately; the sweep/staging evidence catches it) — the Storefront-API migration is the named follow-up, out of scope here.
- **LMDW `short_description` prose varies by editor**: the sweep measures the ABV share before any adapter work; rows without parseable ABV are held by the live hygiene rule and surface in the correction queue, never silently mispriced.
- **Cloudflare egress blocking** (D6) — staging smoke per source, Posti playbook on failure.
- **Catalog-size drift mid-walk** (D1's short-page bound) — self-corrects next daily run; the sweep's row-count reconciliation makes drift visible.

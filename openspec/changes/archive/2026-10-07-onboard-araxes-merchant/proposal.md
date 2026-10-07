# Onboard araxes merchant

## Why

The catalog ingests five live sources today: the Alko domestic reference feed and four WooCommerce Store API adapters (alks/DE, longero/EE, kippis/FI, mydrink/EE). Araxes (araxes.ee) grants the operator rights to its public WooCommerce Store API (`https://araxes.ee/wp-json/wc/store/v1/products`, 1,630 products), making it the sixth live source and the third Estonian retailer beside longero and mydrink.

A read-only probe (page-1 sample of 100 rows plus the full 45-term category census) shows the established Store API shape: EUR minor-unit prices with the effective (sale) price in `prices.price`, all rows `type: simple`, `X-WP-TotalPages` pagination (17 pages at `per_page=100`), a populated `weight` field in kg, and names that embed ABV/volume in parseable forms (`…1L 40% Whisky`). Two measured gaps gate the work:

- **Category vocabulary (bare Estonian terms).** Araxes sends undecorated, singular category terms (`Kange alkohol`, `Õlu`, `Punane vein`, `Vahuvein`, `Viin`, `Brändi`, `Džinn`, `Kalvados`). Exact matching in `mapSourceCategory` misses all of them today — the mydrink vocabulary keys are the decorated or plural forms that store happens to use (`kange alkohol ▾`, `õlu ▾`, `punased`, `vahuveinid`). Structured leaf taxonomy means the expected category-driven drop share is small (~6%: the RTD `Kokteilid` rows, the ambiguous bare `Vein` term, and ~73 genuine merch rows in `Suupisted`/`Kotid`/`Kommid`/`Pakend`); the full sweep (task 1.1) measures it precisely.
- **SKU/EAN gap (0 of 100 sampled SKUs match an accepted EAN form).** Every SKU is a short internal code (`42631` shape); the `brands` array is empty on every sampled row. Records therefore ingest EAN-less and brand-less by design — the accepted parallel-catalog behavior of alks, longero, and mydrink — with the upsert's compound tier (name + brand + containerType + unitVolume) making repeat runs idempotent.

## What Changes

### Sweep before wiring

- The read-only sweep (`scripts/araxes-catalog-sweep.ts`, cloned from the mydrink sweep) walks the whole 1,630-product catalog through the production parser and measures the drop taxonomy, the category census, the SKU/EAN gap, brand coverage, and the ESTIMATED share (ABV/volume unparsed from names). Findings scope the vocabulary list; the sweep re-runs after the mapping change to measure the new drop rate.

### Additive category vocabulary

- `SWEDISH_SOURCE_CATEGORY_MAP` gains the Araxes terms as additive exact keys, each to an existing canonical category (design D3 table): the bare strong-alcohol parent `kange alkohol` plus its leaves (`viin`, `brändi`, `džinn`, `tekila`, `kalvados`, `armanjakk`, `absint` → spirits; `viski`, `konjak`, `rumm`, `gin`-family, `bitter`, `liköör` already map); the wine leaves only — `punane vein`/`valge vein`/`roosa vein`/`puuvilja- ja marjavein` → wine, `vahuvein`/`šampanja` → sparkling-wine, `hõõgvein`/`vermut`/`liköörvein, portvein, šerri` → fortified-wine; the bare low-alcohol leaves `õlu` → beer, `long drink` → long-drink; the non-alcoholic section `alkoholivaba` and its children (`energiajook`, `karastusjook`, `mahl`, `vesi`, `alkoholivaba õlu/vein/vahuvein`) → non-alcoholic.
- The wine parent `Vein` and its identically named leaf stay unmapped: both surface as the same lowercase key, and `categoryImpliedMapping` takes the first mappable term in payload order, so mapping it would misfile sparkling rows as still — a wrong excise key. Sparkling resolves only from its own leaf terms. `Kokteilid` stays unmapped (RTD cocktails span spirits-based and fermented-based taxation — the mydrink precedent). Non-beverage merch terms (`Suupisted`, `Pähklid`, `Krõpsud`, `Lihasnäkid`, `Kotid`, `Kommid`, `Pakend`) stay unmapped and land in the correction queue rather than guessing a tax category.

### Adapter + wiring

- `AraxesFeedAdapter` (`merchantId: 'araxes'`) becomes a thin subclass of the shared `WooStoreFeedAdapter` walk — no shared-code change (the rule-of-three extraction happened at kippis; mydrink and kippis subclasses since). Registered in both composition sites and exported from the package index; composition tests assert six live adapters resolve by merchantId.
- No parser change. All rows stay EAN-less with a per-row correction error (no fabricated EANs); unparsed ABV/volume ingests as ESTIMATED through the parser's existing keyed-uncertainty path. The feed's structured attributes (`Maht`, `Alkoholisisaldus`, `Päritolumaa`) are deliberately unread this change — a measured follow-up candidate if the sweep's ESTIMATED share justifies it.
- Registry seed row added (`merchant-registry.seed.ts`, alks pattern): local and staging receive it through the deploy pipeline's seed step. Production is never seeded — the merchant registers through the ops console (runbook §2.0), which auto-grants a merchant with no governance records per the owner's blanket-permission policy, with both audit entries recorded.

### Progressive rollout: local → staging → production

- **Local**: seed row plus a `RETAILER_API`/`GRANTED` governance record in local D1; producer + workflow run end-to-end locally against the live feed (read-only GETs); compound-key merge verified on a second run.
- **Staging**: PR merge auto-deploys the worker; registry row ships via seed + governance granted through the ops console; first ingest verified via a manual Workflow instance.
- **Production**: gated deploy, registration + auto-grant via the ops console, first ingest verified, first scheduled 00:00 UTC enqueue observed once.

## Non-goals (this change)

- No attribute-aware parsing — the feed's structured `Maht`/`Alkoholisisaldus`/`Päritolumaa` attributes stay unread; the sweep's ESTIMATED share decides whether a follow-up parser extension is worth its design cost (name-vs-attribute precedence and contradiction rules).
- No EAN or brand recovery from names, image filenames, or meta fields — records stay EAN-less and brand-empty.
- No cocktail (`Kokteilid`), bare `Vein`, or merch-category mapping — tax-ambiguous or not beverage categories; unmapped rows are the correction queue's input, never a guessed assignment.
- No upsert matching relaxation (no fuzzy or name-only cross-merchant joins).
- No frontend changes — araxes products flow through the existing catalog, product pages, and search unchanged; image fields stay unread (design D4 of alks-feed-and-import-vat).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `data-acquisition`: Permitted-source ingestion gains araxes as the sixth live adapter (registry row, `RETAILER_API` governance, daily cadence); the Store API adapter registry counts six merchants. SKU/EAN rules unchanged — non-matching SKUs keep the record EAN-less and correction-flagged.

## Impact

- `packages/core-domain` (category mapper vocabulary), `packages/data-acquisition` (new araxes adapter), `apps/api-worker` (two adapter-map composition sites), `packages/data-platform` (merchant-registry seed row), `scripts/araxes-catalog-sweep.ts` (new, re-run for verification).
- Data: `merchant_registry` + `source_governance` rows per environment (local, staging, production). No schema migrations; `retail_offers`/`product_master` gain rows only through the normal upsert path.
- No frontend, API-contract, or dependency changes.

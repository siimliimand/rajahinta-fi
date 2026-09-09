# Design: alks.fi feed and import VAT

## Context

Exploration probed the live Store API and the existing ingestion seam. Facts the design rests on:

- `GET https://alks.fi/wp-json/wc/store/v1/products` is public, JSON, and paginated (`per_page` max 100, `X-WP-Total` / `X-WP-TotalPages` headers). Sampled catalog: 2,856 products, all EUR, prices in minor units.
- SKU shape is `<cc>-<EAN>` (example `de-4740077005916`). A 150-row sample had 142 pure 13-digit digits after prefix stripping; a full sweep in task 7.1 verifies the pattern holds.
- No structured ABV/volume/container fields exist in the API. They live in the name text (`"Herb Liqueur 35% 0.5 l PET"`) and in categories (`Likööri`, `Liquor`, `Väkevä`). Product weight is a plain decimal kg string.
- The ingestion pipeline already provides: `IFeedAdapter` multi-provider registry keyed by `merchantId`, governance gate (fail-closed, default PENDING), data-quality checks, mapping, upsert by EAN, hourly per-merchant scheduling from the registry. Onboarding a merchant should not require a deploy.

## Decisions

### D1: EAN from SKU prefix, validated per row

The adapter strips a two-letter prefix from the SKU and validates the remainder as a 13-digit EAN. Matching SKUs yield the EAN, the pipeline's natural upsert key. A non-matching SKU is not guessed around: the record keeps a null EAN and the row lands in the correction queue with a per-row error. This mirrors the Alko adapter's per-row error discipline.

### D2: Sequential pagination with an explicit bound

The adapter walks pages in order (`page=1..X-WP-TotalPages`, `per_page=100`), one request at a time, so an hourly job never hammers the store. `X-WP-TotalPages` caps the walk; a malformed or missing header stops after the current page with an error, not an unbounded loop. Page-level failures accumulate in `errors[]` per the adapter contract; the adapter never throws for recoverable failures. A page that does return partial data still yields its records, so one bad page costs one page, not the run.

### D3: Name/category parser, ESTIMATED on failure (owner decision)

Parsing is a pure function: ABV and volume come from the name with a rule-based regex (`35%`, `0,5 l`/`0.5 l`/`500 ml` forms), container type from name tokens (`PET`, `pullo`, `tölkki`) through `standardizeContainerType`, beverage category from categories through `mapSourceCategory`. When name and category both yield a type, the mapping must agree; disagreement is a correction error, not a silent pick.

A product where ABV or volume cannot be parsed is still ingested: `alcoholByVolume` null (the `RawFeedRecord` shape already allows it) and the resulting offer carries reliability ESTIMATED. The calculator then reports why its number is uncertain instead of hiding the product. Rationale: the project rule "unknown = ESTIMATED, never silently assumed" and the alternative (dropping records) silently shrinks the catalog.

### D4: Images out

The adapter reads no image fields. They remain available in the payload if a later change wants URLs; nothing in this change captures or stores them.

### D5: Import VAT as a versioned dataset, base composition as a versioned rule

New `packages/core-domain/src/vat/` module, shaped after the excise engine: a pure calculation, a seeded rate dataset (`v1: 24% before 2024-09-01`, `v2: 25.5% from 2024-09-01`), and effective-date resolution so a calculation on a past date resolves the rate that applied then. The base composition (retail price + transport + alcohol excise + container duty) lives in the same versioned dataset rather than inline code, because the legal base can change independently of the rate.

Rates are seed data reviewed by humans; nothing auto-publishes. The VAT dataset version joins the idempotency cache-key composition so a rate change invalidates cached results.

### D6: Calculator integration and domestic exclusion

`computeItemCosts` gains an itemized cost line, `Import VAT (estimated)`, populated when the offer's seller country differs from the destination (FI). The gate is the same seller/buyer country signal transaction classification already consumes; no new boolean is invented in the orchestrator. The line carries: amount, rate version id, base breakdown (each component with its own amount), reliability status, timestamp. Domestic (`alko`) offers skip the line, and a compliance test pins their results byte-identical to the pre-change engine. The legacy `POST /calculations/landed-cost` endpoint gains an optional VAT input with the same semantics so both entrypoints stay consistent.

### D7: Weight storage and estimation preference

`weight_grams` joins the product master (forward migration on D1 and pg parity). `RawFeedRecord` gains an optional `weightGrams`; the Alko feed keeps not sending it. Transport estimation uses the stored product weight when present and falls back to the current volume-based estimate otherwise, so existing behavior and tests hold for every product without a feed weight.

### D8: Governance stays human

The pipeline refuses to fetch alks.fi until an operator grants the source in the ops console (`RETAILER_API`, `GRANTED`). The change ships the seed registry row, the wiring, and the runbook step; the grant itself is a staging action performed during verification, and production grants follow the runbook.

## Risks

- **SKU pattern coverage is sampled, not proven.** Task 7.1 sweeps the full catalog and reports the EAN share; a low share would demote EAN matching for alks and needs a decision before apply-phase completion, not after.
- **Name parser recall is unknown.** The same sweep reports the ESTIMATED share. A high share means the parser needs another iteration; the catalog still ingests meanwhile.
- **VAT base composition is a legal reading, not a fact.** The disclaimer remains structural; the base rule is versioned so a correction is a dataset change, not a code change.

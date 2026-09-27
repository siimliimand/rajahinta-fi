# Onboard mydrink merchant — Design

## Context

Four merchants already ingest through the governed pipeline: the Alko domestic reference feed and three WooCommerce Store API adapters (alks, longero, kippis) that share the `WooStoreFeedAdapter` walk and `parseAlksStoreProducts` verbatim. The shared parser resolves the beverage category from categories-first/name-tokens-second with a contradiction gate, extracts the EAN from accepted SKU shapes, and keeps (never drops) rows whose SKU or ABV/volume fail to parse. The upsert port matches records to `product_master` by EAN first, then a compound key (name, brand, containerType, unitVolume), then creates.

MyDrink (mydrink.ee) is an Estonian WooCommerce retailer owned by the operator, who granted documented scraping rights and confirmed the catalog carries no EAN data. The 1.1 sweep (707/707 rows, 8 pages, zero page failures) measured: 263 records parse today (name-token fallback), 443 drop on "no canonical beverage category" (Estonian vocabulary), 707/707 SKUs internal codes, 0/707 rows with a named brand, 100% `type: simple`, 100% EUR minor-unit, ~99.6% ABV/volume parsed from names.

## Goals / Non-Goals

**Goals:**

- MyDrink offers ingest through the governed pipeline on the daily cadence, forming their own catalog products (parallel-catalog behavior, alks/longero precedent).
- Estonian category vocabulary covered additively, with still-vs-sparkling wine resolved from leaf terms only so the excise key is never misfiled.
- Zero shared-code changes: the kippis change already generalized the walk; mydrink is a thin subclass.

**Non-Goals:**

- EAN or brand inference of any kind (owner-confirmed absent; parser reads no image data per D4 of alks-feed-and-import-vat).
- Cocktail/gift-category mapping (tax-ambiguous; correction queue owns it).
- Upsert matching relaxation, correction-queue remediation, frontend changes.

## Decisions

### D1 — Thin subclass, shared walk unchanged

`MydrinkFeedAdapter extends WooStoreFeedAdapter` with `merchantId: 'mydrink'`, the standard `WOO_STORE_API_PATH`, and error-label prefix `mydrink` — the same shape as the kippis/longero/alks subclasses. The walk's pagination discipline (sequential pages, `per_page=100`, first usable `X-WP-TotalPages` caps, per-page/per-row errors never thrown) applies verbatim. Alternative — a fourth verbatim walk copy — rejected: the shared module exists since kippis and invites drift.

### D2 — SKU/EAN: no parser change

All 707 SKUs are internal codes (`MTBE026-1-2-1` shape); none matches an accepted EAN form, so every row ingests EAN-less with the existing per-row correction error. Zero-padding, truncating, or hashing SKUs into EANs is rejected as fabrication. The correction-error volume (one line per row per run) is accepted log noise — the same discipline kippis applied to its non-matching minority.

### D3 — Category vocabulary (additive, leaf-first for wine)

Sweep-census-scoped additive keys in `SWEDISH_SOURCE_CATEGORY_MAP`, each exact-match after trim/lowercase (the store's ` ▾` and `☝️` decorations are part of the raw term and therefore of the key):

| Term | Canonical | Tax key | Rows (census) |
|---|---|---|---|
| `kange alkohol ▾` | spirits | spirits | 251 |
| `vodka` | spirits | spirits | 52 |
| `viski` | spirits | spirits | 36 |
| `konjak` | spirits | spirits | 38 |
| `rumm` | spirits | spirits | 19 |
| `gin` | spirits | spirits | 15 |
| `liköör` | liqueur | spirits | 70 |
| `punased` | wine | wine_still | 107 |
| `valged` | wine | wine_still | 102 |
| `pakiveinid` | wine | wine_still | 86 |
| `vahuveinid` | sparkling-wine | wine_sparkling | 22 |
| `shampanjad` | sparkling-wine | wine_sparkling | 28 |
| `õlu ▾` | beer | beer | 52 |
| `siider` | cider | other_fermented | 14 |
| `alkoholivaba ▾` | non-alcoholic | other_fermented | 25 |
| `karastusjoogid` | non-alcoholic | other_fermented | 19 |

Deliberately unmapped:

- **`veinid ▾` (parent, 152 rows)** — `categoryImpliedMapping` returns the first mappable term in payload order; mapping the parent would misfile `Vahuveinid`/`Shampanjad` rows as still wine whenever the parent sorts first, and still vs sparkling carry different excise rates. Sparkling resolves only from its own leaves; wine rows without any leaf stay in the correction queue. The 1.2 re-sweep measures that remainder.
- **`kokteilijoogid` (64) / `kokteil` (27)** — RTD cocktails span spirits-based and fermented-based taxation; no grounded canonical exists, so the rows stay unmapped rather than guessed.
- **`☝️ Lahja alkohol` (77), `☝️ Kange` (82), `☝️ Pakkumised ▾`, `Kingiideed ▾`, `Avaleht`, `Pandipakend`, country names** — promo/decorative/navigational sections; tax-heterogeneous or not beverage categories at all. `muu` already maps through the existing explicit-other token.

Name tokens remain the second source; the contradiction gate is unchanged.

### D4 — Matching: compound tier only, accepted parallel catalog

With no EAN and an empty `brands` array on every row, the upsert's EAN tier never fires and the compound key carries `brand: ''`. Consequences, accepted with the owner:

- Repeat runs are idempotent — a mydrink row compound-matches its own previous insert (same name, container, volume).
- MyDrink products form their own `product_master` rows; they do not join Alko/kippis EAN-matched catalog entries. This is the same accepted parallel-catalog behavior alks and longero live with (kippis was the EAN exception, not the rule).
- A name edit on the mydrink side creates a new row beside the old one; the correction queue and a later data-quality pass own reconciliation.

### D5 — Registry, governance, and the pantti rule

Registry row: `('mydrink', 'MyDrink', 'EE', 'https://mydrink.ee', 'json', 86400000)`. Governance: `RETAILER_API` / `GRANTED`, sourceUrl `https://mydrink.ee/wp-json/wc/store/v1/products`, reason records the owner-operated-site scraping right. `depositSystem` stays `false`: the feed's `Pandipakend` attribute describes the Estonian deposit system, not Finnish pantti membership, and the parser's conservative rule (membership unknown at the feed level, never assumed) holds.

### D6 — Rollout shape (kippis playbook)

Local D1 rows → PR merge (staging auto-deploys) → staging D1 rows + manual Workflow instance via the Workflows REST API → gated production deploy → production D1 rows + manual instance → observe the next scheduled 00:00 UTC enqueue. Records executed commands in the change notes at each step.

## Risks / Trade-offs

- [Parallel catalog: mydrink products never join existing EAN-matched rows] → accepted with the owner (no EAN data exists); revisitable if EANs are later added to the WordPress catalog, at which point the EAN tier starts matching with no code change.
- [Wine rows without leaf terms drop to the correction queue] → measured by the 1.2 re-sweep; a parent-term mapping stays available as a follow-up only if the remainder is material and the payload order is proven leaf-safe.
- [Name-edit duplicates on the merchant side] → compound key includes name; accepted, data-quality pass owns reconciliation.
- [Correction-error log volume: one kept-without-EAN line per row per run] → bounded by catalog size (707), precedent accepted.
- [Cloudflare/WordPress in front of the feed] → sequential `per_page=100` (8 pages), page failures degrade per the adapter contract; the sweep saw zero failures.

## Migration Plan

1. Local: sweep (done) → vocabulary + adapter work → local D1 rows → local end-to-end + compound-key idempotency check.
2. Staging: PR merge auto-deploys → staging D1 rows → manual instance → API verification.
3. Production: gated deploy → production D1 rows → manual instance → API/page verification → next 00:00 UTC scheduled-run observation.

Rollback: `wrangler rollback` (deploy) or revoke the governance record (data flow stops; the pipeline writes upserts only, no destructive migrations). Registry rows are inert without a `GRANTED` governance record.

## Open Questions

- None blocking. The 1.2 re-sweep refines the wine-leaf remainder; cocktail mapping waits for a grounded tax ruling.

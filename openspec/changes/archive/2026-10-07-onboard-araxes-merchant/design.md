# Onboard araxes merchant — Design

## Context

Five merchants already ingest through the governed pipeline: the Alko domestic reference feed and four WooCommerce Store API adapters (alks, longero, kippis, mydrink) that share the `WooStoreFeedAdapter` walk and `parseAlksStoreProducts` verbatim. The shared parser resolves the beverage category from categories-first/name-tokens-second with a contradiction gate, extracts the EAN from accepted SKU shapes, and keeps (never drops) rows whose SKU or ABV/volume fail to parse. The upsert port matches records to `product_master` by EAN first, then a compound key (name, brand, containerType, unitVolume), then creates.

Araxes (araxes.ee) is an Estonian WooCommerce retailer; the operator holds usage rights to its public Store API (recorded as the governance note). The read-only probe measured: `X-WP-Total` 1,630 (17 pages at `per_page=100`), page-1 sample 100/100 EUR, 100/100 `type: simple`, 100/100 empty `brands`, 0/100 SKUs matching an accepted EAN form (5-digit internal codes), and a 45-term category tree: `Kange alkohol` 860 (leaves: `Viin` 280, `Viski` 133, `Brändi` 120, `Konjak` 88, `Liköör` 79, `Džinn` 67, `Rumm` 60, `Bitter` 13, `Tekiila` 12, `Kalvados` 5, `Armanjakk` 2, `Absint` 1), `Vein` 519 (bare singular leaves: `Punane vein` 171, `Valge vein` 167, `Vahuvein` 96, `Roosa vein` 16, `Puuvilja- ja marjavein` 19, `Šampanja` 15, `Liköörvein, portvein, šerri` 12, `Hõõgvein` 1, `Vein` 1), `Lahja alkohol` 131 (`Õlu` 75, `Kokteilid` 23, `Long drink` 12, `Vermut` 11, `Siider` 10), `Alkoholivaba` 68 (`Karastusjook` 24, `Energiajook` 16, `Mahl` 10, `Vesi` 8, `Alkoholivaba vahuvein` 6, …), plus non-beverage merch (`Suupisted` 41, `Kotid` 21, `Krõpsud` 19, `Lihasnäkid` 8, `Kommid` 7, `Pakend` 4). Every product row also carries structured attributes (`Maht`, `Alkoholisisaldus`, `Pant`, `Kuller`, `Transport üle Eesti`, `Kohaletoimetamine`, `Päritolumaa`) that the shared parser never reads.

## Goals / Non-Goals

**Goals:**

- Araxes offers ingest through the governed pipeline on the daily cadence, forming their own catalog products (parallel-catalog behavior, alks/longero/mydrink precedent).
- Estonian category vocabulary covered additively — the *bare singular* spellings this store sends — with still-vs-sparkling wine resolved from leaf terms only so the excise key is never misfiled.
- Zero shared-code changes: the kippis change already generalized the walk; araxes is a thin subclass.

**Non-Goals:**

- Attribute-aware parsing (structured `Maht`/`Alkoholisisaldus`/`Päritolumaa` stay unread; measured follow-up — the sweep's ESTIMATED share decides).
- EAN or brand inference of any kind (parser reads no image data per D4 of alks-feed-and-import-vat).
- Cocktail, bare-`Vein`, or merch-category mapping (tax-ambiguous or not beverage categories; correction queue owns them).
- Upsert matching relaxation, correction-queue remediation, frontend changes.

## Decisions

### D1 — Thin subclass, shared walk unchanged

`AraxesFeedAdapter extends WooStoreFeedAdapter` with `merchantId: 'araxes'`, the standard `WOO_STORE_API_PATH`, and error-label prefix `araxes` — the same shape as the alks/longero/kippis/mydrink subclasses. The walk's pagination discipline (sequential pages, `per_page=100`, first usable `X-WP-TotalPages` caps, per-page/per-row errors never thrown) applies verbatim. Alternative — extending the shared parser to read attributes — rejected for this change: it introduces name-vs-attribute precedence and contradiction decisions that deserve their own measured change if the ESTIMATED share warrants it.

### D2 — SKU/EAN: no parser change

All sampled SKUs are short internal codes (`42631` shape); none matches an accepted EAN form, so every row ingests EAN-less with the existing per-row correction error. Zero-padding, truncating, or hashing SKUs into EANs is rejected as fabrication. The correction-error volume (~1,630 lines per daily run, 2× mydrink's accepted volume) is accepted log noise — the same discipline mydrink applied to its 100%-internal-SKU catalog.

### D3 — Category vocabulary (additive, leaf-first for wine, bare-spelling keys)

Sweep-census-scoped additive keys in `SWEDISH_SOURCE_CATEGORY_MAP`, each exact-match after trim/lowercase. Araxes sends *undecorated* terms — the mydrink keys (`kange alkohol ▾`, `õlu ▾`, `punased`, `vahuveinid`, `shampanjad`) do not match and stay untouched:

| Term | Canonical | Tax key | Rows (census) |
|---|---|---|---|
| `kange alkohol` | spirits | spirits | 860 (parent) |
| `viin` | spirits | spirits | 280 |
| `brändi` | spirits | spirits | 120 |
| `džinn` | spirits | spirits | 67 |
| `tekila` | spirits | spirits | 12 |
| `kalvados` | spirits | spirits | 5 |
| `armanjakk` | spirits | spirits | 2 |
| `absint` | spirits | spirits | 1 |
| `punane vein` | wine | wine_still | 171 |
| `valge vein` | wine | wine_still | 167 |
| `roosa vein` | wine | wine_still | 16 |
| `puuvilja- ja marjavein` | wine | wine_still | 19 |
| `vahuvein` | sparkling-wine | wine_sparkling | 96 |
| `šampanja` | sparkling-wine | wine_sparkling | 15 |
| `hõõgvein` | fortified-wine | intermediate_products | 1 |
| `vermut` | fortified-wine | intermediate_products | 11 |
| `liköörvein, portvein, šerri` | fortified-wine | intermediate_products | 12 |
| `õlu` | beer | beer | 75 |
| `long drink` | long-drink | other_fermented | 12 |
| `alkoholivaba` | non-alcoholic | other_fermented | 68 (parent) |
| `energiajook` | non-alcoholic | other_fermented | 16 |
| `karastusjook` | non-alcoholic | other_fermented | 24 |
| `mahl` | non-alcoholic | other_fermented | 10 |
| `vesi` | non-alcoholic | other_fermented | 8 |
| `alkoholivaba õlu` / `alkoholivaba vein` / `alkoholivaba vahuvein` | non-alcoholic | other_fermented | 8 |

Already-mapped keys that araxes rows hit unchanged: `viski`, `konjak`, `rumm`, `bitter`, `liköör`, `siider`. Mapping the bare `kange alkohol` and `alkoholivaba` parents is safe — their entire subtrees resolve to one tax family (spirits; other_fermented), unlike wine where still-vs-sparkling split. The ABV boundary guard (>22% never resolves to a fermented bucket) holds unchanged.

Deliberately unmapped:

- **`Vein` (parent, 519) and its identically named leaf (1)** — both lowercase to the same key `vein`; mapping it would misfile `Vahuvein`/`Šampanja` rows as still wine whenever the parent sorts first, and still vs sparkling carry different excise rates. Sparkling resolves only from its own leaves; the single genuinely ambiguous `Vein`-only row joins the correction queue. (mydrink `veinid ▾` precedent.)
- **`Kokteilid` (23)** — RTD cocktails span spirits-based and fermented-based taxation; no grounded canonical exists, so the rows stay unmapped rather than guessed (mydrink `Kokteilijoogid` precedent).
- **Merch terms (`Suupisted` 41, `Kotid` 21, `Krõpsud` 19, `Lihasnäkid` 8, `Kommid` 7, `Pakend` 4)** — snacks, bags, candies, packaging: not beverage categories at all; the ~100 merch rows drop to the correction queue.
- **Attributes are not categories** — `Kuller`, `Transport üle Eesti`, `Kohaletoimetamine`, `Päritolumaa`, `Kingiideed`, `Eripakkumised` never reach the mapper (the parser reads categories only).

Name tokens remain the second source; the contradiction gate is unchanged. Expected category-driven drops ≈ 97/1,630 (~6%); task 1.1's sweep measures the real number before the vocabulary lands, and 1.2's re-sweep after.

### D4 — Matching: compound tier only, accepted parallel catalog

With no EAN and an empty `brands` array on every row, the upsert's EAN tier never fires and the compound key carries `brand: ''` (brand derived from the name by `deriveBrand` on the product side, per existing behavior). Consequences, accepted:

- Repeat runs are idempotent — an araxes row compound-matches its own previous insert.
- Araxes products form their own `product_master` rows; they do not join other merchants' EAN-matched entries, and cross-merchant compound matches are best-effort exact-name hits (different naming conventions between stores make these rare).
- A name edit on the araxes side creates a new row beside the old one; the correction queue and a later data-quality pass own reconciliation.

### D5 — Registry, governance, and the pantti rule

Registry seed row (alks pattern): `('araxes', 'Araxes', 'EE', 'https://araxes.ee', 'json', 86400000)` — daily cadence, firing on the first hourly tick after the 24-hour bucket boundary (00:00 UTC). Staging receives it through the deploy pipeline's seed step; **production is never seeded** — the operator registers the merchant through the ops console (`POST /ops/console/merchants`), which auto-grants a merchant with no governance records per the blanket-permission policy, with `merchant_registry` created and `source_governance` created as two audited entries. Governance source: `RETAILER_API`, sourceUrl `https://araxes.ee/wp-json/wc/store/v1/products`, note records the operator's usage right.

`depositSystem` stays `false`: the feed's `Pant` attribute describes the Estonian deposit system, not Finnish pantti membership, and the parser's conservative rule (membership unknown at the feed level, never assumed) holds — the mydrink `Pandipakend` decision (D5 there) verbatim.

### D6 — Rollout shape (kippis/mydrink playbook)

Local D1 rows → PR merge (staging auto-deploys) → staging governance grant via the ops console + manual Workflow instance via the Workflows REST API → gated production deploy → production registration + auto-grant via the console → observe the next scheduled 00:00 UTC enqueue. Executed commands recorded in the change notes at each step.

## Risks / Trade-offs

- **Vocabulary drift**: if araxes later decorates terms (` ▾`) the way mydrink's storefront does, exact keys miss again. Mitigation: the sweep re-runs on vocabulary changes; additive keys only, each pinned by a test.
- **ESTIMATED share unknown until the sweep**: araxes names embed ABV/volume in parseable shapes on the sampled page, but wine rows (519) may hide one of the two. The sweep quantifies it; the attribute-aware follow-up is the designed escape hatch, not a blocker.
- **Correction-queue volume**: ~1,630 EAN-less notes per daily run plus ~100 merch drops — accepted, sized before the grant (sweep numbers recorded in the notes).
- **Parallel catalog**: no cross-merchant price competition for araxes rows unless names compound-match exactly — the accepted behavior of every internal-SKU merchant before it.

## Migration Plan

No schema migrations. The registry seed row rides the normal seed step (local/staging); production registration is a console action. Offers and products land only through the normal fetch → map → lint → upsert workflow; revocation (console) is the kill switch and stops ingestion without purging landed data.

## Open Questions

(none — the sweep task 1.1 resolves the only unknowns: exact drop taxonomy and ESTIMATED share, before the vocabulary keys in 1.2 are finalized.)

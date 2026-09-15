# Onboard kippis merchant — Design

## Context

Three Store API merchants already ingest through the same pipeline: the Alko domestic reference feed and two WooCommerce Store API adapters (alks, longero) that share `parseAlksStoreProducts` verbatim. The shared parser extracts the EAN from SKUs shaped `^[a-z]{2}-\d{13}$`, resolves the beverage category from categories-first/name-tokens-second with a contradiction gate, and keeps (never drops) rows whose SKU or ABV/volume fail to parse. The upsert port matches records to `product_master` by EAN first, then a compound key, then creates.

Kippis.net is a Finnish online retailer (Cloudflare-fronted WordPress/WooCommerce). Its Store API payload matches the established shape; its SKU vocabulary does not (bare 13-digit and GTIN-14 numerics). Kippis is the third WooCommerce merchant — the generalization point `longero.adapter.ts` explicitly reserved ("rule of three: generalization waits for a third WooCommerce merchant").

## Goals / Non-Goals

**Goals:**

- Kippis offers ingest through the governed pipeline and match existing catalog products by EAN.
- One shared Store API walk instead of three copies; alks/longero behavior unchanged (golden fixtures stay green).
- EAN extraction for kippis' numeric SKU shapes without guessing around unknown codes.

**Non-Goals:**

- Image-filename EAN recovery (parser reads no image data — D4 of alks-feed-and-import-vat).
- Multipack case-price semantics.
- Correction-queue remediation, upsert chunk-size tuning, staging alks un-pause.

## Decisions

### D1 — Generalize the walk (rule of three reached)

Extract the identical page-walk from `alks.adapter.ts`/`longero.adapter.ts` into one shared module (parameterized by `merchantId`, error-label prefix, collection URL path); the three adapters become thin subclasses. Alternative — a third verbatim clone — rejected: the longero adapter comment reserves generalization for exactly this point, and three copies of the walk discipline invite drift.

### D2 — SKU/EAN shapes

Accepted forms: `^[a-z]{2}-\d{13}$` (existing), `^\d{13}$` (bare EAN-13), `^0\d{13}$` (GTIN-14 of a 13-digit EAN — deterministic, strip the leading zero). Everything else (12-digit numerics, internal codes, empty) keeps the record EAN-less with a correction error naming the SKU; zero-padding 12-digit UPC-A is rejected as a guess. The correction-error message text (it names the old pattern) is updated with the new shapes.

### D3 — Category vocabulary (additive, sweep-scoped)

Kippis uses plural/group Finnish terms that exact-match misses today. Planned additive keys, each to an existing canonical: `valkoviinit`/`punaviini`t/`kuohuviinit` → wine/sparkling-wine (plural of mapped singulars), `viskit`/`rommit`/`liköörit`/`konjakit`/`ginit`/`aperitiivit` → spirits/fortified-wine (plural or type-noun of mapped terms), `vodkat ja viinat` → spirits, `siiderit lonkerot ja seltzerit` → cider (per the Swedish `cider och blanddrycker` precedent), `virvoitusjuomat ja mikserit`/`energiajuomat` → non-alcoholic (per the existing `virvoitusjuomat`/`energy drink` precedent). Name tokens remain the second source; the contradiction gate is unchanged. Task 1.2 trims or extends this list from sweep data only.

### D4 — Matching needs no new code

`readEanFromSku` output feeds the existing upsert tier-1 EAN match, so kippis rows join existing `product_master` rows (Finnish retail EANs) directly; unmatched rows fall to the tier-2 compound key or create new products. The sweep reports the expected direct-match share. No matching-code changes.

### D5 — Registry, governance, and the pantti rule

Registry row: `('kippis', 'Kippis', 'FI', 'https://www.kippis.net', 'json', 86400000)`. Governance: `RETAILER_API` / `GRANTED`, sourceUrl `https://www.kippis.net/wp-json/wc/store/v1/products`, reason records the operator's documented scraping right (owner blanket-permission policy, longero precedent). `depositSystem` stays `false`: the parser rule ("pantti membership unknown at the feed level, never assumed") was written for foreign merchants, but the justification holds here too — the kippis feed carries no pantti flag, so the conservative value stands.

### D6 — Rollout shape (longero playbook)

Local D1 → PR merge (staging auto-deploys) → staging D1 rows + manual Workflow instance via the Workflows REST API → gated production deploy → production D1 rows + manual instance → observe the next scheduled 00:00 UTC enqueue. Merge is PR-based (current branch-protection convention, unlike longero's fast-forward).

## Risks / Trade-offs

- [Multipack rows: `33cl x 24 tölkkiä` names parse per-container volume while `prices.price` is the case price → €/l skew on those offers] → the sweep quantifies the share; accept initially, data-quality pass owns reclassification; no shared-parser semantics change without data.
- [Parser change touches alks/longero ingestion] → new shapes are additive; existing golden fixtures and correction-error tests must stay green (the error-text update is asserted).
- [Walk generalization regression] → the extraction is mechanical and both existing adapters keep their unit tests; composition tests assert all four adapters resolve by merchantId.
- [`complete-job-claim` subrequest exhaustion (longero 4.2/5.2 incident shape)] → kippis' catalog (677) is smaller than longero's (985); the engine's instance-level retry recovered both prior incidents; chunk-size tuning remains an out-of-scope follow-up.
- [Cloudflare in front of the feed] → sequential `per_page=100` (7 pages), page failures degrade per the adapter contract; no rate-limit signals in the probe.

## Migration Plan

1. Local: sweep → parser/mapper/adapter work → local D1 rows → local end-to-end.
2. Staging: PR merge auto-deploys → staging D1 rows → manual instance → API verification.
3. Production: gated deploy → production D1 rows → manual instance → API/page verification → next 00:00 UTC scheduled-run observation.

Rollback: `wrangler rollback` (deploy) or revoke the governance record (data flow stops; the pipeline writes upserts only, no destructive migrations). Registry rows are inert without a `GRANTED` governance record.

## Open Questions

- None blocking. Task 1.1's sweep refines the 1.2 vocabulary list and the 2.1 SKU-shape scope (e.g. whether 12-digit rows are worth a ruling).

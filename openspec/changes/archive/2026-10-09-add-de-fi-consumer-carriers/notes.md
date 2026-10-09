# Change notes — add-de-fi-consumer-carriers

## What shipped

Two curated DE→FI carrier rate sources on the existing curated rail (adapter
with an in-repo deterministic dataset behind `ICarrierRateSource`, monthly
governance-gated cron with skip-on-unchanged, data-quality gauge entries) —
no new machinery:

- **`pakettipojat`** (EUROTRAFIK GmbH, Tarp DE) —
  `packages/data-acquisition/src/adapters/pakettipojat-rate.source.ts`:
  18 parcel home-delivery rows on the carrier's own 28 kg unit brackets
  (28 → 540 kg, €36.90 → €646.20, each listed edge a unit-count ceiling
  transcribed verbatim) + 9 pallet rows at the worst-case destination zone
  (zone 9, postinumerot 94000–97999; 740 → 5,180 kg, €395 → €1,815).
  27 rows total.
- **`norrlog`** (TS Logistik GmbH & Co. KG, Kropp DE) —
  `packages/data-acquisition/src/adapters/norrlog-rate.source.ts`:
  10 parcel rows on the 25 kg carton cap / 10-carton ladder (25 → 250 kg,
  €37.00 → €370.00 — one carton = one 25 kg bracket = €37.00) + 7 pallet
  rows at the worst-case zone (8\*–9\*; 740 → 5,000 kg, €447 → €1,527).
  17 rows total.

Both datasets observed 2026-10-09 (`PAKETTIPOJAT_OBSERVED_AT` /
`NORRLOG_OBSERVED_AT` = `2026-10-09T00:00:00Z`; every row carries it as its
`observedAt`). Adjacent brackets are separated by the 1 g
`BRACKET_BOUNDARY_EPSILON_KG` boundary offset (same pattern as
fransberg/omniva) so a basket at an exact edge prices in the cheaper band.
Every row: DE→FI, EUR, VAT-inclusive, recipient-paid
(`sellerInvolvementIndicator` false). Registration follows the Omniva
checklist (design D5): barrel exports, `composeCuratedCarriers()` entries,
`expectedTransportCarriers()` gauge additions, cron/observability test pins,
ARCHITECTURE.md / METRICS.md / guardrails SKILL.md rows, freshness-alert
comment. No schema migration; the monthly `0 5 1 * *` trigger already
existed.

## Sources and validity

- **Pakettipojat:** price list "Kuljetushinnat",
  `https://www.pakettipojat.com/page/5/kuljetushinnat`. The live page
  requires JS and serves bots a "Client Challenge"; the transcription was
  taken from the complete Wayback capture
  `http://web.archive.org/web/20260807200917/…` (captured 2026-08-07).
  Known upstream anomalies — flagged here, NOT inherited into the dataset:
  - pickup-point column lists a "169 kg 209,30 €" row between the 168 kg
    and 224 kg rows (the unit pattern says 196 kg). It belongs to the
    excluded pickup-point service and does not affect this dataset;
  - pallet zone 6 lists "800 kg 309 €" between 770 kg 384 € and
    1480 kg 489 € (the zone pattern says ~409 €). Zone 9 is transcribed
    instead, so the typo does not propagate — but any future re-zoning must
    re-verify the table rather than trust it.
- **Norrlog:** FI price page
  `https://norrlog.com/fi/hinnat-ehdet/hinnasto/` is the authoritative
  source (the DE/EN pages lag it); carton/pallet specifics from the
  freight-specifications page `https://norrlog.com/gross-schwer-gib-her/`.
  Clean WordPress/Elementor HTML, no bot protection; spot-checked live
  2026-10-09.
- **Validity / refresh cadence:** a quarterly manual re-check of both price
  pages is sufficient. The monthly cron tick is a no-op per carrier while
  the newest stored `observed_at` equals that dataset's constant; a refresh
  happens only when a dataset table is edited AND its `*_OBSERVED_AT`
  constant is bumped to the review date — the date is the dedupe key, so a
  bump without a price change is harmless but creates an append.

## Transcription conventions (durable rules)

- **Verbatim rows, never formula-reconstructed** (design D2): published
  values are copied as-is, including irregular ones. Within the transcribed
  Pakettipojat home-delivery column the 140 kg row is €179.50 where the
  ×€36.90 unit pattern would say €184.50, and the 392 kg row is €502.60
  where the pattern diverges too; both are published values kept on
  purpose, and the sanity tests pin them so a well-meant "fix" cannot
  silently reprice them. Norrlog's published flat step — the final two
  pallet brackets (3,700 kg and 5,000 kg) both cost €1,527 — is likewise
  verbatim, not "fixed".
- **Pallets at the most expensive destination zone** (design D3): both
  carriers price pallets by destination postal-code zone and the offer
  model has no zone dimension, so each bracket is stored once at the worst
  zone (Pakettipojat zone 9; Norrlog zones 8\*–9\*). The price is then
  conservative for every Finnish destination — a basket must never be
  underpriced by quoting a cheaper zone. Parcel brackets are zone-free on
  both carriers, so the conservative surface is pallet-only. A zone column
  is the documented future fix if pallet volume justifies a schema change.
- **Home-delivery service level only** (design D1): pickup-point delivery
  is deliberately EXCLUDED, not missed — Pakettipojat "DHL
  pakettitoimitus Suomeen (lähimpään noutopisteeseen)" at €29.90 per 28 kg
  unit to 600 kg, Norrlog DHL→Posti pickup/locker at €28.00 per carton.
  The offer model has no service-level dimension and bracket selection is
  first-match (`selectBestBracketOffer` returns the first row whose
  bracket contains the weight), so two service levels sharing one weight
  bracket would make the quoted price row-order-dependent while
  certifying VERIFIED. Home delivery also matches the incumbent Fransberg
  dataset's service basis, keeping the three DE→FI quotes comparable.
- **Norrlog 25 kg carton cap + 10-carton ladder ceiling are documented
  assumptions** (design D1): a carton is 12 slots (12×1 L bottles, 6×3 L
  Bag-in-Box, or 3 trays of 24×0.33 L cans), roughly 20–25 kg gross; the
  synthetic brackets use the conservative 25 kg cap, carton N mapping onto
  `[(N−1)·25 kg + ε, N·25 kg]` so the existing quantity-scaled weight
  lookup selects the carton count natively. The ladder is capped at
  10 cartons (250 kg): beyond that the carrier ships pallet freight in
  practice, so the parcel tier hands off to the pallet rows instead of
  quoting a €1,000+ carton train against a €447 pallet.

## Refresh hygiene

Re-transcription procedure for a price-list change (Pakettipojat is the
hard case; design D4):

1. Attempt the live page first, retrying across the intermittent JS
   Client Challenge; fall back to the newest complete Wayback capture —
   snapshots are a first-class refresh fallback, not an exception path.
2. Diff the fresh table against the incumbent dataset before bumping
   anything, specifically re-checking the two known Pakettipojat upstream
   anomaly spots (the "169 kg" pickup row; zone-6 "800 kg €309") — so a
   corrected upstream typo cannot slip in silently as a "price change"
   without a human glance, and an uncorrected one is not inherited.
3. Edit the bracket tables, bump `PAKETTIPOJAT_OBSERVED_AT` /
   `NORRLOG_OBSERVED_AT` to the review date, deploy. The next monthly tick
   (`0 5 1 * *`, handler
   `apps/api-worker/src/cron/curated-rate-refresh.ts`) appends the new
   rows; the per-carrier skip-on-unchanged guard (newest stored
   `observed_at` === dataset constant) keeps the append-only
   `transport_offers` history free of no-op generations — re-appending an
   unchanged dataset would write duplicate rows, not new history.
   Out-of-band sync for local work: `wrangler dev --env <env> --remote
   --test-scheduled` + `curl "http://localhost:8788/__scheduled?cron=0+5+1+*+*"`.

The governance gate still applies per carrier: without a GRANTED
`source_governance` record the carrier's refresh appends nothing.

## Ops provenance (2026-10-09 run)

- **Grants:** written as direct guarded `source_governance` INSERTs
  (`permission_status` GRANTED, `acquisition_method` MANUAL_VERIFICATION,
  each price page as `source_url`) into each environment's D1 BEFORE that
  environment's refresh. The ops-console route
  (`POST /ops/console/governance/:merchantId/grant`) could not be used: it
  resolves the id in `merchant_registry` and 404s on unknown merchants
  ("Merchant … is not in the registry"), and curated carriers deliberately
  have no registry rows. This mirrors the recorded Omniva remediation
  precedent (transport-confidence-unlock change notes, 2026-10-04:
  direct INSERT "mirroring the fransberg/posti precedent").
- **Deploys:** staging `0bc454c9-759e-46f9-898c-d3c6330ca83a`, production
  `d1ac6b5b-c761-466d-a2b1-7b2d7453b1e0`.
- **Refresh results:** fransberg, posti, omniva skipped (dataset constants
  unchanged — the expected skip path); pakettipojat appended 27 rows,
  norrlog 17. Verified in D1 per environment: per-carrier counts, DE→FI
  lane, `observed_at` = `2026-10-09T00:00:00.000Z`.
- **Audit trail:** no `audit_events` rows — consistent with all three
  pre-existing curated carriers (their grants were likewise direct rows);
  the `status_reason` field carries the provenance.

## Caveats for the product surface

- **Transport insurance is mandatory for alcohol on both carriers and is
  EXCLUDED from the rate rows** — it must not be folded into them; the
  landed-cost calculator would carry it as its own line, and surfacing it
  is a product decision, not a transcription one (design non-goal):
  - Pakettipojat: separate transport insurance is always required for
    shipments containing alcohol or liquids ("Jos kuljetustilauksesi
    sisältää alkoholia tai nesteitä, tarvitaan aina erillinen
    kuljetusvakuutus. Ilman sitä korvausvaatimusta ei käsitellä.") — no
    damage claims are processed without it; since 10.7.2019 all shipments
    are uninsured unless the customer purchases insurance. The insurance
    price is unpublished and not part of the rate rows.
  - Norrlog: optional transport insurance at €3.80 per carton, excluded
    from the rate rows; without insurance, carrier liability follows
    NSAB 2000 at €0.80/kg.
- **Norrlog prices are "from" prices**, finalized at checkout.

## Deferred owner data

`merchant_registry.carrier_id` assignments are NOT set for the new
carriers: no German-lane merchants exist in the registry yet (the five
registered merchants are already assigned to posti/fransberg/omniva from
2026-10-04). Assignments are owner data, applied via ops when German-lane
merchants arrive — never guessed in code.

Owner attention flag (design D6): both operators are small German
forwarders with mixed public customer reviews (EUROTRAFIK GmbH, Tarp;
TS Logistik GmbH & Co. KG, Kropp). Treat them as lane options on DE→FI —
quote alternatives alongside Fransberg — never keystone carriers; two
carriers instead of one on the lane is the mitigation for operator
continuity/reputation risk. Any later assignment remains a single
reversible UPDATE per the established pattern (set the one `carrier_id`;
the reverse is setting it back to NULL).

## Rollback

No schema or code rollback path exists or is needed — everything this
change put in motion is data-level:

1. **Stop the refreshes:** revoke (delete) the two `source_governance`
   rows for `pakettipojat` and `norrlog`. The fail-closed gate then skips
   both carriers and the cron appends nothing further; the append-only
   `transport_offers` history already written remains as history.
2. **Unassign merchants (if assignments were ever made):** reassign
   `merchant_registry.carrier_id` for the affected merchants — a single
   UPDATE per merchant (back to NULL or to a replacement carrier); never
   guess a replacement.

Reversal is symmetric to the grant: re-inserting the governance rows
re-enables the refresh path with no code change.

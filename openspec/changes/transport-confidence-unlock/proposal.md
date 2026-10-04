# Proposal: transport-confidence-unlock

## Why

Every calculator result reads LOW, and every reliability surface reads
zero-green, by construction rather than by data. Verified 2026-10-03 against
the repo:

- `POST /calculator` returns `Transport: 0 c, UNAVAILABLE` for every product,
  which forces overall confidence LOW on every line
  (`landed-cost-calculator.service.ts` builds the confidence report from the
  transport status).
- The merchants/reliability surface shows 0% VERIFIED across all 5 merchants
  (9,374 offers, 100% ESTIMATED).
- `transport_offers` carries no carrier rows at all.

Four independent locks produce this, and no single fix unlocks the surface:

1. **Empty carrier table.** The curated Fransberg/Posti datasets exist in-repo,
   but the append path (`curated-rate-refresh.ts`, cron `0 5 1 * *`) is
   fail-closed on `source_governance`: without GRANTED records for the carrier
   IDs `fransberg`/`posti` it appends nothing.
2. **Merchant name used as carrier ID.** `estimateTransport` resolves
   `carrier = input.transportMethod ?? offer.merchant` and the query is a
   case-sensitive `WHERE carrier = ?`. The five merchants (alko, alks, kippis,
   mydrink, longero) share no name with any carrier ID, so even a fully
   populated table matches nothing.
3. **Vocabulary clash on the tier join.** The estimator matches
   `packageTier === product.containerType`. The product side carries container
   material (bottle, can, plastic, carton, metal, other); the transport side
   carries shipping packaging (parcel, pallet). The sets are disjoint by
   construction, so the candidate list is always empty and the lookup always
   degrades.
4. **No VERIFIED write path.** Ingestion pins every retail offer to ESTIMATED
   at birth ("ingestion never self-certifies VERIFIED"), and no production
   code path ever promotes one. The freshness classifier computes VERIFIED in
   QA reports but writes nothing back. The zero-green reliability page is
   therefore correct behavior, and the site legend ("Green = verified")
   describes a state the system cannot currently reach.

Two adjacent correctness gaps surface once matching is fixed, and belong in
the same change: the transport lookup ignores `quantity` (bracket matched on
per-unit weight), and the calculator never passes `storedWeightGrams` although
the domain service and D1 schema both support it (design D7 is live everywhere
except the calculator path). Both affect which bracket, and therefore which
price, a customer is quoted.

## What Changes

- **Ops unlock (no code):** grant `fransberg` and `posti` through the existing
  governance console, trigger the curated refresh, and verify carrier rows
  land in `transport_offers`. Pre-flight reads confirm cron deploy state and
  `weight_grams` coverage first.
- **Carrier assignment:** migration adds a nullable `merchant_registry.carrier_id`.
  The D1 product port enriches offers with it; the calculator prefers it over
  the merchant-name fallback. NULL means unknown, and unknown stays UNAVAILABLE
  — no guessed assignments. Carrier IDs are normalized (trim, lowercase) at the
  domain boundary.
- **Shipping tier from weight:** the estimator derives parcel/pallet from total
  shipment weight against the carrier's own dataset ceilings (Fransberg:
  31.5 kg parcel cap, 720 kg pallet unit), replacing the containerType
  equality. `containerType` stops being a transport input.
- **Quantity-aware weight:** the lookup weight is per-unit weight × quantity,
  which matches the curated datasets' per-parcel-count bracket shape natively.
- **Stored weight wired:** the calculator path finally reads `weight_grams`
  and passes `storedWeightGrams` to the estimator, making design D7 true on
  the surface users hit.
- **Honest transport VERIFIED:** an exact bracket match certifies VERIFIED only
  when the weight basis is the stored product weight; a volume-estimate basis
  caps the result at ESTIMATED. Downgrade-only, consistent with the existing
  rail semantics.
- **Operator verification path (owner-gated):** a console verify-offer action
  following the governance-grant trust pattern (bearer fail-closed, operator
  attribution, audit event). Verified offers age to STALE through the existing
  freshness windows, and merchant-reliability picks the statuses up through
  its ordinary aggregation.
- **Spec deltas** for transport-estimation, operator-console, and
  merchant-reliability-scoring, plus deliberate updates to the compliance pins
  that assert today's UNAVAILABLE/LOW behavior.

## Decision points

- **Carrier truth per merchant** (task 1.1): the mapping values
  (`alks → fransberg`? `alko → posti`?) are owner data. The change ships the
  column and the resolution; values are filled from owner answers, never
  invented.
- **Phase 5 (verification path)** ships only on explicit owner approval. If
  deferred, the legend-contingent task (5.3) covers the honest copy fallback.

## Capabilities affected

- `transport-estimation` — carrier resolution, quantity weight, tier
  derivation, VERIFIED gating
- `operator-console` — audited verify-offer action
- `merchant-reliability-scoring` — verified share becomes reachable; ageing

## Non-goals

- No fabricated carrier lanes: Posti's published tables contain no TO-Finland
  cross-border lanes, and the dataset stays domestic-only. Longero (EE origin)
  has no carrier dataset and stays UNAVAILABLE until real data exists.
- No new carrier transcriptions in this change (separate data work once the
  owner provides tables).
- No ranking changes: reliability remains display-only, per the neutrality
  guardrail.
- No ingestion self-certification: the ESTIMATED-at-birth policy stands;
  verification is an explicit, attributed, human action.

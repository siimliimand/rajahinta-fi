# Design: transport-confidence-unlock

## Context

The calculator's transport lookup
(`packages/core-domain/src/calculator/landed-cost-calculator.service.ts:1013`)
resolves `carrier = input.transportMethod ?? offer.merchant` and calls
`TransportEstimationService.estimate(carrier, origin, destination, weightKg,
containerType)`. The estimator filters `transport_offers` by carrier (exact,
case-sensitive SQL), origin, destination, `packageTier === containerType`, and
weight bracket. Any miss throws `NotFoundError`, which the calculator catches
into the graceful `0 ¢ / UNAVAILABLE` degradation that feeds the confidence
report. With the current data and join semantics, the miss is total.

## Decisions

### D1 — Carrier assignment lives in the merchant registry

`merchant_registry` gains a nullable `carrier_id` (migration 0027). NULL means
"unknown which carrier ships this merchant's parcels", and unknown produces
the existing UNAVAILABLE degradation — the honest default. The D1 product-data
port joins the registry when assembling retail offers and exposes `carrierId`
on the offer contract. The calculator resolves
`carrier = transportMethod ?? offer.carrierId ?? merchant` — an explicit user
transportMethod still wins.

No default values are seeded. Filling `alks → 'fransberg'` (plausible:
DE origin, Fransberg prices DE→FI lanes) is an owner decision recorded by the
pre-flight task, applied as data.

### D2 — Carrier IDs normalize at the domain boundary

`TransportEstimationService.estimate` normalizes the requested carrier
(trim + lowercase) before querying, and the curated write path already stores
lowercase IDs (`'fransberg'`, `'posti'`). One choke point, no schema change,
and the merchant-name fallback (`'Fransberg'`) stops losing on case.

### D3 — Shipping tier derives from weight against the dataset's own ceilings

The tier join (`packageTier === product.containerType`) is a category error:
container material is not shipping packaging. Replacement rule: the shipment
is a `parcel` while its weight fits within the carrier's largest parcel
bracket ceiling (derivable from the carrier's own offers), and `pallet` above
it. No new policy constant — the dataset is the threshold. Fransberg's shape
(31.5 kg parcels, 720 kg pallets, per-parcel-count prices) demonstrates both
tiers; Posti's single domestic tier degrades cleanly when the other tier has
no rows.

`containerType` remains on the product contract for packing/classification;
it just stops being a transport input.

### D4 — Quantity scales the lookup weight

`estimateTransport` multiplies the resolved per-unit weight by
`input.quantity` before bracket selection. This matches the curated datasets'
bracket shape, where bracket n prices an n-parcel shipment
(`(count-1) × cap + ε` to `count × cap`). Buying 12 × 1 kg now prices a
12 kg shipment instead of a 1 kg one. Basket shipping already sums item
weights and needs no change for this.

### D5 — Stored weight reaches the calculator path

`D1ProductDataPort` selects `weight_grams` and the calculator passes it as the
estimator's sixth argument. `resolveEstimationWeight` then prefers stored
grams (design D7) and reports `weightBasis: 'STORED_PRODUCT_WEIGHT'`. The
pre-flight task measures coverage first; products without stored weight keep
the volume estimate and its ESTIMATED cap (D6).

### D6 — VERIFIED requires an exact bracket on a stored weight

Today `reliabilityStatus = selection.reliability === 'EXACT' ? 'VERIFIED' :
'ESTIMATED'`, which certifies VERIFIED even when the bracket was matched on a
water-density guess. New rule: exact bracket match AND
`weightBasis === 'STORED_PRODUCT_WEIGHT'` yields VERIFIED; anything else caps
at ESTIMATED. Downgrade-only, aligned with the sanity-rail semantics
(`atMostEstimated`): a status can only get worse through this rule, never
better, and no monetary figure moves.

### D7 — Verification is an explicit operator action

`POST /ops/console/offers/:id/verify` (route naming per console conventions):
bearer fail-closed, `validateOperator` attribution, one audit row via
`WorkerAuditService`, sets the offer's `reliability_status = 'VERIFIED'` and
records `verified_at`/`verified_by` (migration extends the offers table or a
side table — implementation follows the existing audit-pair pattern used by
governance transitions). Re-verification is allowed; there is no un-verify
endpoint in scope (supercede by a later operator decision, not by accident).

This is deliberately NOT an ingestion path. "Ingestion never self-certifies
VERIFIED" stays true; a human with a name on record is the only writer.

### D8 — Verified offers age like everything else

The freshness windows that already define `actualStatus` in the data-quality
classifier become the write-back truth for verified rows: past the window, a
VERIFIED offer degrades to STALE through the existing freshness job rather
than staying green forever. Merchant-reliability needs no change — it
aggregates stored statuses — but the merchant-reliability-scoring spec gains
the ageing scenario so the behavior is pinned.

### D9 — The legend is not edited in this change (unless verification defers)

Once phases 2–5 land, green exists and the "Green = verified" legend is simply
true. If the owner defers phase 5, task 5.3 applies the honest copy fallback
(legend describes the scale without implying green is present) so the promise
never outruns the data.

## Compliance blast radius (enumerated)

Pins asserting today's behavior, updated deliberately in task 4.1:

- `tests/golden/golden-dataset.test.ts:519` — LOW-confidence golden fixture
- `tests/compliance/import-vat-ranking-neutrality.test.ts:36` — Transport
  line pinned `0 / UNAVAILABLE`
- `apps/api-worker/src/routes/__tests__/event-calc.routes.test.ts:392` —
  explicit UNAVAILABLE zero
- `tests/integration/historical-price-flow.test.ts` (+ D1 twin) — recorder
  degradation expectations

Tests that seed their own D1 state without carrier rows keep their expected
outputs; only assertions about the join semantics change, plus new
carrier-seeded fixtures that exercise the fixed matching. Golden fixtures stay
rail-free, and every monetary figure remains byte-identical under the D6
downgrade (status-only change).

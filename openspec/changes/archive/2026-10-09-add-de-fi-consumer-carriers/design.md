# Design

## Context

The curated-carrier machinery is proven three times over (fransberg, posti,
omniva — the Omniva addition of 2026-10-04 is the freshest worked example):
an `ICarrierRateSource` adapter with a deterministic in-repo dataset, a
monthly governance-gated cron that appends to the append-only
`transport_offers` table with skip-on-unchanged, and a data-quality gauge
that reports honest zeros for expected-but-empty carriers. This change adds
two adapters on that rail; it introduces no new machinery.

Source facts from the 2026-10-07 research (recorded here because the
transcriber needs them and the live pages may move):

- Pakettipojat (EUROTRAFIK GmbH): price list at
  `https://www.pakettipojat.com/page/5/kuljetushinnat`. The site sits behind
  an intermittent JS client challenge; Wayback holds fresh complete
  snapshots (e.g. 2026-08-07). Parcel pickup-point table: 28 kg €29.90
  stepping linearly per 28 kg unit to 600 kg €590.00; home-delivery table:
  28 kg €36.90 to 540 kg €646.20 — **with irregular rows** (e.g. 140 kg
  €179.50 breaks the ×€36.90 pattern) and a suspected typo ("169 kg
  €209.30"). Pallets: 9 FI postal zones × brackets 740/770/800/1480/2220/
  2960/3700/4440/5180 kg; zone 9 (94000–97999) is the most expensive
  (€395 → €1,815); the source contains a known zone-6 anomaly ("800 kg:
  €309"). Alcohol is carried (dedicated lane page /page/55/) but always
  requires separate transport insurance.
- Norrlog (TS Logistik GmbH & Co. KG): FI price page
  `https://norrlog.com/fi/hinnat-ehdet/hinnasto/` is the authoritative,
  clean-HTML source (DE/EN pages lag it). Parcels are priced per 12-slot
  carton: €28.00 pickup-point/locker (DHL→Posti), €37.00 home delivery;
  €3.80/carton optional transport insurance. Pallets: 4 destination
  postal-code zones × brackets 740/900/1480/2220/2960/3700/5000 kg; zones
  8\*–9\* are the most expensive (€447 → €1,527). No bot protection. Carton
  slot definitions (12×1L bottles, 6×3L Bag-in-Box, 3×24 cans) put a carton
  at roughly 20–25 kg gross.

## Goals / Non-Goals

**Goals:**

- Two carrier ids, `pakettipojat` and `norrlog`, fully registered across the
  curated pipeline, observability, tests, and docs — no orphan adapters.
- Quotes on the DE→FI lane become available through three independent
  operators (Fransberg, Pakettipojat, Norrlog), each usable as a merchant
  assignment or explicit transport method.
- Pallet quotes that are conservative for every Finnish destination without
  a schema change.

**Non-Goals:**

- No API integrations — neither carrier exposes one (Norrlog's
  `api.norrlog.com` is an auth-gated internal SPA backend; Pakettipojat has
  nothing).
- No postal-zone dimension in `transport_offers`, no estimator change.
- No `merchant_registry.carrier_id` assignments in this change (no German-
  lane merchants exist in the registry; assignments are owner data applied
  via ops when they arrive).
- No dataset for shippii.delivery/DETRAFIK as a separate carrier (same
  parent as Pakettipojat), and no ME Group / DSV / Turun Vapaavarasto rows
  (not carriers for this use case; DSV's parcel terms ban alcohol outright).
- No transport-insurance modeling — Pakettipojat's insurance price is
  unpublished and Norrlog's is an optional add-on; the mandatory-for-alcohol
  insurance caveat is documented in the change notes for a future surfacing
  decision instead.

## Decisions

### D1 — One service level per carrier; unit-based parcels become synthetic kg brackets

The offer model has no service-level dimension, and bracket selection is
first-match (`selectBestBracketOffer` returns the first row whose bracket
contains the weight): two service levels with identical brackets would make
the quoted price row-order-dependent while certifying VERIFIED. Every
existing curated dataset therefore carries exactly one service level per
carrier (Fransberg = home delivery, Omniva = Standard), and the new
datasets follow suit: **home delivery only** for both Pakettipojat and
Norrlog. This matches the incumbent DE→FI carrier's service basis, so the
three lane quotes stay comparable; pickup-point prices (€29.90 / €28) are
recorded in the dataset docblocks and change notes as deliberately excluded,
not missed.

Unit-based pricing maps to parcel brackets of the form
`[(n−1)·cap + ε, n·cap]` with the 1 g `BRACKET_BOUNDARY_EPSILON_KG` used by
fransberg/omniva, so the existing quantity-scaled weight lookup selects the
right unit count natively. Caps: **28 kg** for Pakettipojat (the carrier's
own unit; its published home table runs to 540 kg). For Norrlog, **25 kg**
as a documented conservative carton cap derived from its slot definitions,
with the ladder capped at **10 cartons (250 kg)** — beyond that the carrier
ships pallet freight in practice, so the weight-derived tier hands off to
the pallet rows instead of quoting a €1,000+ carton train against a €447
pallet. Alternative considered: transcribing both service levels and
relying on tie-breaking — rejected; it would require estimator changes this
change deliberately excludes.

### D2 — Transcribe verbatim, never reconstruct

The task-annotation guide for datasets (and the spec delta) forbids
rebuilding tables from inferred formulas: the transcriber copies published
rows as-is, including irregular ones (Pakettipojat's 140 kg €179.50), and
flags suspected typos ("169 kg" row; zone-6 "800 kg €309") in the module
docblock instead of "fixing" them. Alternative considered: reconstructing
the linear per-unit pattern — rejected; silent divergence from the published
page is exactly the dishonesty the landed-cost product exists to avoid.

### D3 — Pallets transcribe at the most expensive zone

Both carriers price pallets by destination postal-code zone; the offer model
has no zone dimension. Each weight bracket is stored once at the most
expensive zone (Pakettipojat zone 9; Norrlog zones 8\*–9\*). The price is
then conservative for every destination; the spec delta pins this as a
durable fidelity rule. Alternatives considered: a zone column (schema
migration + estimator change — deferred until pallet volume justifies it)
and zone-1 cheapest-zone pricing (optimistic — rejected outright). Parcel
brackets are zone-free on both carriers, so the conservative surface is
pallet-only. Reliability semantics are untouched: max-zone is a pricing
choice, not a weight-basis issue.

### D4 — Provenance constants and diff-before-publish

`PAKETTIPOJAT_OBSERVED_AT` / `NORRLOG_OBSERVED_AT` are set to the
transcription date and bumped only when a re-transcription actually changes
prices — the cron's skip-on-unchanged then keeps the offer history free of
no-op generations, and the spec delta makes the rule durable. Pakettipojat
refresh hygiene additionally includes the Wayback fallback path and a diff
against the two known source-table anomalies so a corrected upstream typo
cannot slip in silently as a "price change" without a human glance.

### D5 — Registration follows the Omniva checklist exactly

Barrel exports, `composeCuratedCarriers()` map entries,
`expectedTransportCarriers()` additions, cron routing-pin and expected-
carrier-map test updates, ARCHITECTURE.md rows (adapter tree, module
description, transport flow sentence, operational status table), METRICS.md
carrier list, guardrails SKILL.md curated-trio mention, freshness-alert
comment. No `wrangler.jsonc` change — the monthly `0 5 1 * *` trigger
already exists. No golden-dataset change — golden tests use synthetic
carriers.

### D6 — Governance grants are ops data, applied per the established path

`POST /ops/console/governance/{carrierId}/grant` with
`MANUAL_VERIFICATION` and the price-page URL as `source_url`, once per
carrier — otherwise the fail-closed gate appends nothing. Owner attention is
flagged on the trust caveat: both operators are small Flensburg-area
forwarders with mixed public reviews; they are quote options on one lane,
never keystone carriers.

## Risks / Trade-offs

- [Upstream price pages drift or vanish (Pakettipojat is bot-challenged)]
  → Wayback snapshots are a first-class refresh fallback; diff-before-publish
  catches silent drift; observedAt makes staleness visible.
- [Conservative pallet overquotes (max-zone) may look uncompetitive for
  southern-Finland destinations] → accepted: honest-pessimistic beats
  optimistic; zone dimension is the documented future fix if pallet volume
  justifies it.
- [Norrlog's 25 kg carton cap is an inference from slot definitions, not a
  published kg bracket] → cap is stated and reasoned in the dataset
  docblock; a heavier product quoting two cartons errs on the safe side.
- [Operator continuity/reputation risk (small GmbHs, mixed reviews)]
  → two carriers instead of one on the lane; neither is merchant-critical
  until an owner assigns it; governance records keep the decision auditable
  and revocable.
- [Insurance is mandatory for alcohol on both carriers but excluded from
  rate rows] → documented caveat in change notes; excluded because one price
  is unpublished and the other is optional add-on plumbing — surfacing it is
  a product decision, not a transcription one.

## Migration Plan

1. Land adapters, registration, tests, docs (code-only, zero runtime
   effect — the governance gate skips ungranted carriers).
2. Deploy the api-worker; grant `pakettipojat` and `norrlog` via the ops
   console; trigger the curated refresh; verify per-carrier row counts and
   lanes in staging, then production.
3. Rollback: revoke governance (rows stop refreshing; append-only history
   remains) and/or reassign `merchant_registry.carrier_id` values — no
   schema or code rollback needed.

## Open Questions

None — carrier ids, carton caps, zone handling, insurance exclusion, and
deferred merchant assignments are all resolved in the decisions above; the
remainder is transcription mechanics governed by the spec delta.

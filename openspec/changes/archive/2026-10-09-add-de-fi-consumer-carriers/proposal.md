# Proposal: add-de-fi-consumer-carriers

## Why

The Germany→Finland consumer lane — the lane German border-shop alcohol
webshops actually ship on — is covered by a single curated carrier
(Fransberg), so German-lane merchants resolve to one honest carrier or to
UNAVAILABLE, with no alternative quotes. Carrier research completed
2026-10-07 across six delivery websites found exactly two actionable
consumer carriers on this lane: **Pakettipojat** (EUROTRAFIK GmbH, Tarp DE —
the operator behind the shippii.delivery/DETRAFIK affiliate family) and
**Norrlog** (TS Logistik GmbH & Co. KG, Kropp DE). Both publish price lists
that map cleanly onto the `(carrier, route, weight-bracket, package-tier)`
offer model; neither offers an API. The other four sites researched are not
integrable carriers: shippii.delivery is an affiliate front for the
Pakettipojat parent (no data of its own), ME Group is a quote-only B2B
alcohol 3PL, DB Schenker (now DSV) bans alcohol in its parcel terms and is
receive-only for consumers, and Turun Vapaavarasto operates an excise
warehouse but explicitly handles no transport.

## What Changes

- **Pakettipojat curated dataset** (`pakettipojat`): DE→FI parcel
  home-delivery table (€36.90 per 28 kg unit) plus pallet freight
  transcribed at the most expensive FI postal zone (zone 9: €395 at 740 kg
  → €1,815 at 5,180 kg). The pickup-point service (€29.90 per unit) is
  deliberately excluded — the offer model has no service-level dimension
  and bracket selection is first-match, so duplicate brackets would quote
  arbitrarily (design D1); home delivery matches the incumbent Fransberg
  dataset's service basis for lane comparability. Source:
  pakettipojat.com/page/5/kuljetushinnat (bot-protected; fresh Wayback
  snapshots as fallback; two known internal typos to flag, not inherit).
- **Norrlog curated dataset** (`norrlog`): DE→FI parcel home-delivery
  (€37 per carton; pickup-point/locker €28 excluded on the same grounds),
  modeled on a documented 25 kg carton cap with a 10-carton ladder ceiling,
  plus pallet freight at the most expensive postal zone (€447 at 740 kg →
  €1,527 at 5,000 kg). Source:
  norrlog.com/fi/hinnat-ehdet/hinnasto/ (clean HTML, FI page authoritative).
- **Curated-carrier fidelity rule (spec):** when a carrier prices a tier by
  destination sub-zone and the offer model has no zone dimension, the
  transcription SHALL use the most expensive zone; every dataset row SHALL
  carry an `observedAt` traceable to the transcription date and source page;
  refreshes SHALL diff against the incumbent dataset and skip unchanged
  appends.
- **Registration:** barrel exports, `composeCuratedCarriers()` entries,
  `expectedTransportCarriers()` gauge additions, cron/observability test
  pins — the Omniva checklist, twice. No schema migration, no wrangler
  change (the monthly curated cron trigger already exists).
- **Ops data (owner-gated, no code):** governance grants for `pakettipojat`
  and `norrlog` (`MANUAL_VERIFICATION` + source URLs) via the ops console
  endpoint; `merchant_registry.carrier_id` assignments are **deferred** —
  no German-lane merchants exist in the registry yet, and assignments are
  owner data.

## Capabilities

### New Capabilities

(none — no new capability is introduced)

### Modified Capabilities

- `data-acquisition`: adds a curated carrier rate fidelity requirement —
  conservative max-zone transcription for zone-priced tiers, observedAt
  provenance per dataset row, and diff-before-publish refresh hygiene.

## Impact

- `packages/data-acquisition` — two new carrier source adapters + barrel
  exports + dataset sanity tests (pattern: fransberg/posti/omniva).
- `apps/api-worker` — curated-rate-refresh registration, data-quality
  expected-carrier list, cron routing and observability test pins,
  freshness-alert comment.
- Docs — ARCHITECTURE.md (adapter tree, module description, transport flow,
  operational status rows), METRICS.md, ob-guardrails-project SKILL.md.
- Ops — two `source_governance` rows created via the console (never seeded);
  append-only `transport_offers` rows land on the next curated refresh.
- No database migration, no frontend change, no monetary change to existing
  lanes (new carriers only add rows under new carrier ids).

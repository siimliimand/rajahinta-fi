# Change notes — data quality gates and publication trust

Operator evidence log. Sections here hold **recorded facts, never
predictions**: every placeholder marked `TBD (operator)` is filled by
the operator who ran the command, with the command output as the
source. This file is never pre-filled with expected values — an
estimated count next to a real one is indistinguishable from the real
one, which is the exact failure mode this change exists to prevent.

## 2.1 Alko reference landing

Production data operation — trigger and verification procedure:
`docs/ingestion-runbook.md` §6 ("Alko reference feed — manual
(re-)run and verification"). All commands read-only except the one
registry write called out there (§6.2).

| Metric | Value | Recorded via |
|---|---|---|
| `withReference` before | TBD (operator) | §6.4(b) |
| `withReference` after | TBD (operator) | §6.4(b) |
| EAN join hit-rate | TBD (operator) | §6.4(c) |
| Verified at (UTC) | TBD (operator) | command timestamp |

Supporting before/after pair for the reference offers themselves
(runbook §6.4a) — baseline expected to be 0:

| Metric | Value |
|---|---|
| Alko reference offers before | TBD (operator) |
| Alko reference offers after | TBD (operator) |

Exact commands (production, runbook §6.4 flag pattern):

```bash
cd apps/api-worker

# §6.4(b) withReference — materialized snapshot rows, latest as-of day
wrangler d1 execute DB --remote --env production --command "\
  SELECT COUNT(*) AS with_reference FROM savings_snapshots \
  WHERE as_of = (SELECT MAX(as_of) FROM savings_snapshots) \
    AND alko_reference_cents IS NOT NULL" -y

# §6.4(c) EAN join hit-rate — offered products whose EAN matches an
# Alko-referenced product's EAN / all offered products
wrangler d1 execute DB --remote --env production --command "\
  WITH alko_eans AS ( \
    SELECT DISTINCT pm.ean AS ean FROM retail_offers ro \
    JOIN product_master pm ON pm.id = ro.product_id \
    WHERE ro.merchant = 'alko' AND pm.ean IS NOT NULL), \
  offered AS ( \
    SELECT DISTINCT ro.product_id AS product_id, pm.ean AS ean \
    FROM retail_offers ro JOIN product_master pm ON pm.id = ro.product_id) \
  SELECT (SELECT COUNT(*) FROM offered) AS products_with_offers, \
    (SELECT COUNT(*) FROM offered WHERE ean IS NOT NULL \
      AND ean IN (SELECT ean FROM alko_eans)) AS ean_matched_products, \
    ROUND(100.0 * (SELECT COUNT(*) FROM offered WHERE ean IS NOT NULL \
      AND ean IN (SELECT ean FROM alko_eans)) / \
      NULLIF((SELECT COUNT(*) FROM offered), 0), 1) AS ean_join_hit_rate_pct" -y

# §6.4(a) Alko reference offer count (before/after pair)
wrangler d1 execute DB --remote --env production --command "\
  SELECT COUNT(*) AS alko_reference_offers FROM retail_offers \
  WHERE merchant = 'alko'" -y

# Public-surface confirmation (age gate applies; runbook §6.5)
curl -H "x-age-confirmed: 1" \
  "https://api.rajahinta.fi/api/v1/savings?category=spirits"
# Expect coverage.withReference > 0 after the landing.
```

Endpoint confirmation record (fill after §6.5):

| Check | Result |
|---|---|
| `GET /api/v1/savings?category=spirits` → `coverage.withReference` | TBD (operator) |
| Homepage savings card state (listing CTA restored) | TBD (operator) |

Task 2.1 stays open until the operator records the real numbers above;
task 5.2's "savings coverage after 2.1" live check reads this section.

## 2.2 Posti transcription — operator procedure

The live fetch was attempted from this session (2026-09-30) per the
admin procedure in `posti-rate.source.ts` and confirmed still blocked:

| Attempt | Result |
|---|---|
| `GET https://www.posti.fi/api/price-list/parcels.json` (this session, datacenter egress) | HTTP 403 — the documented CDN block (error 1031 class) |
| Wayback availability API for the same URL | no archived snapshots (re-confirmed) |
| posti.fi public HTML (homepage, business parcel pages) | reachable, but publishes only domestic and outbound (from-Finland) prices — **not** the inbound lane table; transcribing those rows into TO-Finland lanes would fabricate data and was not done |

The block is **egress-IP-specific** (datacenter/Cloudflare ranges), so
the operator's own browser should fetch the endpoint directly:

1. Open `https://www.posti.fi/api/price-list/parcels.json` from a
   normal (residential/mobile) connection and save the payload.
2. Deliver the JSON to the engineer/agent session (or transcribe
   directly per the admin procedure in `posti-rate.source.ts` steps
   1–3): every lane shipping TO Finland, one row per lane + package
   tier + weight bracket, VAT-inclusive EUR cents, `POSTI_OBSERVED_AT`
   bumped to the review date.
3. The transcription lands as the `POSTI_RATES` dataset rows plus the
   golden-fixture test pinning them (task 2.2's remaining deliverable);
   the monthly curated sync publishes them on the next deploy.
4. Record the fetch date + row count here and re-run the calculator
   transport check (task 5.1's fourth evidence item) — until then the
   calculator honestly renders transport as not-included.

| Metric | Value |
|---|---|
| Payload fetched at (UTC) | TBD (operator) |
| Inbound-lane rows transcribed | TBD (operator) |
| `POSTI_OBSERVED_AT` bumped to | TBD (operator) |

Task 2.2 stays open until the transcribed rows land.

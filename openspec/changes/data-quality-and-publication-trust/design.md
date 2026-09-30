# Design — data quality gates and publication trust

## Context

Four live-verified pains (see proposal Why) reduce to one structural gap: ingestion publishes implausible data (price 0, 33 l beer, bundles) and surfaces render the numeric channel while ignoring the status channel the domain already provides. Two datasets are empty in production for non-code reasons (Alko references never ingested; Posti transcription pending a human pass).

Precedents this design reuses rather than reinvents:

- `unit-integrity-and-result-trust`: canonical litres, the `0 < unit_volume < 100` quality-stage invariant (task 1.4 touched `apps/api-worker/src/workflows/ingestion-steps.ts`), the calculator sanity rail (degrade confidence/status, never amounts), and the render-the-degraded-state frontend pattern.
- `savings-snapshots` cron: qualification requires an Alko reference offer with `observedAt`; absence yields no row. The endpoint and honest empty state need zero changes — only data.
- `posti-rate.source.ts`: the transcription admin procedure (dataset row shape, `POSTI_OBSERVED_AT` bump, monthly curated sync, per-carrier skip against duplicate history).

## Gate placement

| Gate | Where | Why there |
|---|---|---|
| Price ≤ 0 | mapping time (`data-mapping.service.ts`, shared by all WooCommerce adapters) | The parser's `readMinorUnitCents` is structural (`/^\d+$/`); plausibility is a mapping concern with a drift-error message, mirroring the existing non-EUR/invalid-price failures. Zero is an integer, so the fix is an explicit check at the map site, not a regex change. |
| Volume ceilings | ingestion quality stage (`ingestion-steps.ts`), next to the existing 0–100 l invariant | Same stage already owns the unit-integrity invariant and its counters; category bounds are added rows in the same table of checks, keeping one enforcement point. |
| Multipack parse | `alks.parser.ts` `parseVolumeMl` | The `24×0,33 l` shape is deterministic (`pack [x×] unit`); parsing it correctly at the source beats every downstream patch. All four WooCommerce adapters reuse this parser. |
| Bundle rejection | `alks.parser.ts` / mapping | Multi-product names cannot yield one honest ABV/volume; held for review like other unreconcilable rows. |

Counter surfaces (zero-price rejections, implausible-volume share) ride the existing data-quality metric plumbing so the Grafana panel (task 4.1) reads counters that already exist rather than defining new exports.

## Honest-state rendering

The calculator result already carries per-component reliability. Transport `UNAVAILABLE` renders as an explicit "not included" line (fi/en) with a pointer to the pending dataset; confidence LOW gets explanatory copy instead of reading as an unexplained defect badge. The homepage savings card branches on the overview response's `withReference` count: zero → honest "reference data landing" state; non-zero → the existing listing CTA. No new API fields are required.

Amounts are never altered (sanity-rail D3). When Posti rows land, the €0.00 line becomes a real figure with no frontend change; when Alko references land, the card flips states with no frontend change. The frontend work is correct on both sides of each data landing.

## Deployment/rollout

Single gated production deploy after verification (task 5.2, `confirm_deploy=yes` precedent). The two data-landing tasks are independent of the deploy: Posti transcription rides the same deploy (dataset edit), Alko ingestion is a production data operation verified by recorded before/after counts. Rollback is `wrangler rollback`; gates reject new bad rows at ingestion, and already-stored implausible rows are corrected by the next sweep rather than by a migration — no backfill is planned in this change.

## Amendment (2026-09-30, owner-approved)

**D3 deviation — Alko adapter mapping.** D3 assumed the reference feed
would land as pure ops ("neither adds an adapter or a field"). The real
source turned out to be Alko's storefront search API (POST + odata
pagination), whose shape differs from the placeholder contract the
golden fixture pinned. The owner approved the scoped mapping change
(field renames, POST pagination, category token table, fixture updated
to the live shape) as the designed "wire the real feed" workflow; the
EAN-less consequence is recorded in change-notes §2.1 as the spike's
real input. No other D-decision is affected: gates reject to
absence/review (D1), ceilings extend the invariant (D2), honesty states
render unchanged amounts (D4).

## Risks

- **Over-aggressive ceilings reject real products** (e.g. novelty 3 l beer crates). Mitigation: ceilings live in one constants table with tests; rejection is null+review, not delete; the share metric makes over-rejection visible on the panel.
- **Alko join hit-rate disappoints** (references ingested but few EAN pairs match). Mitigation: task 2.1 records the hit-rate explicitly; if it is low, that finding scopes the dedupe/matching follow-up rather than blocking this change — the honest empty state stays correct either way.
- **Feed-side typos vs parser bugs blur** (the 33 l Karhu may be a literal shop typo). The multipack parser and ceilings are complementary by design: parse what is parseable, refuse what is implausible.

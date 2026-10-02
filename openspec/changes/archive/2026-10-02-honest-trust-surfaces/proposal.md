# Honest trust surfaces

## Why

A live evidence walk (2026-10-02, production API + D1 reads) found four customer-facing trust surfaces that advertise emptiness — and one of them computes on corrupted inputs:

- **Accuracy statistic is a chicken-and-egg void** — `GET /api/v1/accuracy` returns `count: 0` because the outcome chain (authenticated account → owned calculation record → outcome report) has never been completed by any user. The homepage trust-row and the ranking page render "Ladataan tarkkuustilastoa…" into the honest empty state, permanently. The trust feature can only be earned, never seeded (fabricating outcomes is against the house rules), but today the row shows *only* the zero — while true, useful coverage numbers (7,876 products, ~187k offer observations, a last-sync watermark) sit one query away.
- **€/g — the signature value metric — is invisible everywhere and *wrong* where it shows.** Three stacked layers confirmed live: (1) every listing row embeds `eurPerGram: unavailable` *by documented design* (`search.routes.ts` passes `Number.NaN` as the price because "a `lowestPriceCents` minimum is not any single offer's price"), so no product ever shows the metric in list view; (2) the compare page's EUR_PER_GRAM sort consumes those always-unavailable embeds and therefore sorts by product id — a silent no-op; (3) on detail pages the metric computes per offer, and for pack-notation products the underlying `unit_volume` is corrupted: product 2900 "Karhu Olut 5.3% 24×33 l" stores `unit_volume = 33` (litres — it is 24 × 33 *cl*), yielding a 1.59 c/g "ESTIMATED" metric where real beer runs 15–20 c/g — the mangled row looks 10–15× cheaper than reality. Worse, `unit_volume` feeds the landed-cost calculator and trip math (excise is per-litre), so a 24-pack of Karhu is currently dutied on 33 l instead of 7.92 l. Blast radius: 357 names carry `×` pack notation, 54 have `unit_volume = 0`, 4 have `unit_volume > 5 l`.
- **Blog and Guides pages are empty while the footer advertises them** — `/api/v1/blog/posts` and `/api/v1/guides` both return `{items: [], total: 0}`. The publication pipeline (draft → human publish → per-locale index) works; zero content has been authored. Content authoring is explicitly deferred by the owner — so the honest move is to hide the rooms until they have furniture, and restore them automatically on first publication.
- **"Myyjiä: 1" on 92% of catalog cards** — D1 truth: 7,236 products have exactly one seller, 603 have two, 36 have three. The copy advertises the thinness on every card. Merchant acquisition is a business task outside this change; the code lever is to stop counting sellers on single-seller cards and let the tracked price (and, newly, the €/g chip) carry the value proposition.

All four are the same failure shape as the two prior trust changes: a trust surface publishing either nothing or a number that does not survive contact with the customer's question.

## What Changes

### Pack-notation volume correction (correctness — ships first)

- Ingestion normalization parses pack notation (`N×V` and its `N x V` / comma-decimal variants) in product names and stores the **per-unit** volume in `unit_volume`; pack totals never land in the column again. `24×33 l` → `unit_volume 0.33`.
- A one-time backfill script (`scripts/backfill-unit-volume.mts`, following the `backfill-brand.mts` precedent: `--stats/--sample/--dry-run`) corrects the existing 357/54/4 corrupted rows in production. Because the Tier-2 identity compound key includes `unit_volume`, the runbook pins **backfill BEFORE deploy** — the same sequencing lesson as the brand backfill.

### €/g lights up on listings (design reversal, honesty preserved)

- The listing embed is computed from the **cheapest current-available single offer** — a real offer's price with its provenance, not an aggregate. The "a minimum is not any single offer's price" objection never applied to a minimum: the minimum *is* one specific offer. `search.routes.ts` stops passing `Number.NaN`; unavailability becomes meaningful again (no current offer, incomplete physicals).
- New `ZERO_ETHANOL` unavailability reason: an alcohol-free product (abv = 0) is legitimately €/g-undefined — the reason says why instead of the accusatory `INVALID_ALCOHOL_FRACTION`.
- Product cards render the €/g chip (status-aware, hidden when unavailable); the compare page's EUR_PER_GRAM sort receives real embeds and stops being a no-op.
- Single-seller cards (count = 1) replace "Myyjiä: 1" with the tracked-price framing; multi-seller cards keep the count.

### Accuracy trust-row tells a true story while the user-reported stat is unborn

- `GET /api/v1/accuracy` gains an additive `coverage` block: product count, offer observation count, last ingest watermark — read-time, true numbers only.
- `AccuracyStat` renders a **labeled catalog-coverage mode** when the user-reported count is below the floor; the user-reported statistic returns the moment reports exist. No value is ever seeded or fabricated (house rule: gates reject to absence).
- A dismissible post-calculation nudge on the result view invites the outcome report: logged-in users deep-link to the account `OutcomeReportForm` with the record; anonymous users get the sign-in path. Never blocking, never repeated into spam.

### Content surfaces hidden until first publication

- Blog and guides index pages render `notFound()` (crawler-honest 404) when zero posts/guides are published for the locale; the footer hides the corresponding links. Visibility is computed at request time from publication counts — publishing the first post or guide restores the page and links with no flag and no deploy (house D7: no feature flags).

## Decisions

- **D1: Listings embed the cheapest current single offer's €/g.** The prior design (price input `NaN` on every listing path) treated the aggregate objection as banning the embed outright; it only bans *aggregate-derived* values. A minimum over current offers is one specific offer's price and provenance; the embed is labeled with that offer's reliability. Unavailable states: no current-available offer, missing/invalid volume or fraction, zero ethanol — each named.
- **D2: `ZERO_ETHANOL` is a new reason, not a reused "invalid".** abv = 0 is present and valid data; the metric is undefined because the denominator is zero. The reason string states the physics.
- **D3: Pack correction is backfill-before-deploy.** Tier-2 identity is `(name, brand, containerType, unit_volume)`; changing `unit_volume` shifts identity keys. The ingestion fix lands with the backfill executed against production *before* the new mapping deploys, exactly as in the brand-derivation change. The correction also changes landed-cost inputs for affected rows — that is the point, and it is a correction, not a re-pricing.
- **D4: The trust-row never fabricates.** Coverage numbers are true and *labeled as coverage* ("seurattu valikoima" / "tracked catalog"); the user-reported accuracy appears only when the count is non-zero. Seeding outcomes is prohibited.
- **D5: Hiding is visibility gating, not deletion.** Pages, empty-state components, and footer links remain in the codebase; request-time publication counts decide visibility. First publication restores everything with no deploy and no flag.
- **D6: Single-seller cards stop advertising thinness.** The copy change is presentation-only; no new data surfaces. Merchant acquisition remains a business task.
- **D7: The nudge is account-aware and dismissible.** One prompt on the result view; logged-in users reach the outcome form with the record preselected, anonymous users get the sign-in path. It never blocks the result and never auto-repeats.

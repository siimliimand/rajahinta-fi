# Expand alerts and accuracy breakdowns

## Why

Price alerts and outcome-reported accuracy are live, but both stop one step short of the site's core promise:

- **Alerts watch shelf price only.** The evaluation cron compares the latest materialized `price` summary against the threshold, while the site's value proposition is the *todellinen kokonaishinta* — the landed cost to Finland. The data for that is already materialized: every price observation records a self-contained landed cost (quantity=1 baseline: retail + excise + container duty + one transport to FI, with rule-version snapshots, per-input reliability, and confidence embedded), and the daily/weekly summaries carry `landedCostOpen/Close/Min/Max/AvgCents` per product and merchant. The alert pipeline reads only the price columns today.
- **The accuracy statistic is one global number.** `findAccuracyStatistic({}, …)` answers with a single count and within-margin share. Users cannot see whether estimates hold up for wine versus spirits, or for one carrier versus another. The join path already exists: outcome → calculation record → `product_master.category` (canonical `PRODUCT_CATEGORIES`) and → transport offer.
- **Categories cannot be watched.** `price_alerts` is per-`productId` with the closed kind set `PRICE | TAX_CHANGE`. The canonical category set is objective and already validated at the API boundary, so a category-level threshold alert can be defined deterministically without any curation.

A savings-percentage narrative ("users saved 22%") was considered and dropped by owner decision: reported totals measure estimate accuracy, not savings, and advice-adjacent framing conflicts with the content-vocabulary lint and the display-only insight-surface rule.

## What Changes

### LANDED_COST alert kind

- Third value in the alert kind set (TAX_CHANGE set the extension precedent). Per-product threshold compared against the latest daily product-wide (`merchant IS NULL`) `landedCostCloseCents`, through a reader that mirrors `latestMaterializedPriceCents` — same 7-day summary-freshness guard and 24-hour delivered-row cooldown.
- The alert email discloses the full composition, because the number must be explainable: retail offer, transport offer and route, excise and container-duty dataset versions, confidence, observed-at timestamp, and an explicit "quantity=1 baseline from the materialized summary, not a live quote" statement. Factual wording only.

### CATEGORY alert kind

- Fourth kind: threshold on the minimum shelf price (`priceCloseCents`) across the category's products that have a fresh daily product-wide summary. Deterministic tie-break: lowest `productId` among tied minima. The email names the tripping product, its price, the category, and the threshold.
- Creation contract: a CATEGORY row carries a category and a positive threshold, and no `productId`; the kind-aware guards mirror the existing PRICE/TAX_CHANGE asymmetry.

### Accuracy breakdowns

- `findAccuracyStatistic` gains read-time splits by product category and by transport carrier, joining outcomes to their calculation records. The global statistic and its honesty rules are unchanged: `withinMarginShare` stays null exactly when count is 0, sample size is always displayed, and the wording stays locked to the module labels.
- Minimum sample floor: a breakdown cell under 10 outcomes renders the count only — never a percentage. The floor produces a "count-only" state, distinct from the honest empty state.
- Corridor (seller-country) splits are a non-goal for this change.

## Non-goals (this change)

- No push notifications or new delivery channels — email through the existing email-Worker intent-log path only.
- No per-merchant alert metrics — both new kinds read the product-wide summary rows, matching the PRICE reader.
- No category alerts on landed cost — the category kind watches shelf price; landed cost stays per-product.
- No savings-percentage surfaces, no advice phrasing anywhere (content lint applies to all new copy).
- No anonymous outcome reporting — the owner-checked, windowed, per-record model stands.
- No feature flags — all kinds ship enabled; rollback is `wrangler rollback`.

## Capabilities

### Modified Capabilities

- `price-alerts`: The kind set grows to `PRICE | TAX_CHANGE | LANDED_COST | CATEGORY`; the watchlist contract becomes kind-aware (which reference column each kind requires or forbids); the scheduled evaluation defines one deterministic sweep per kind; landed-cost emails carry full composition disclosure; category sweeps are deterministic with a lowest-productId tie-break.
- `calculation-outcomes`: The public accuracy statistic gains category and carrier breakdowns with a minimum-sample floor (count-only below 10), read-time only, honesty rules preserved.

## Impact

- `packages/data-platform`: migration (alert kind value set, nullable `product_id`, new nullable category column), `price-alert.repository` kind-aware contract guards, `calculation-outcome.repository` breakdown reads, both pg (`drizzle/`) and D1 (`src/d1/`) parity.
- `packages/core-domain`: outcome breakdown types and aggregation filters.
- `apps/api-worker`: `price-alert-evaluation.ts` (two new kind branches, landed-cost reader, category min query, email builders), `alerts.routes.ts` validation, `outcomes.routes.ts` breakdown endpoint, observability counters and failure thresholds extended per kind.
- `apps/frontend`: product-page and category-browse alert entry points, account alerts list kind labels, `AccuracyStat` breakdown display (home + ranking), fi/en messages.
- One D1 migration (next in sequence after 0016). No dependency changes. Background evaluation stays cron-side, off the request path.

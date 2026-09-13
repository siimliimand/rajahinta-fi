# Daily scrape cadence and current-offer views

## Why

The alks feed is scraped hourly (up to 24 runs/day), but every run appends a full catalog of `retail_offers` rows whether prices moved or not. The product page's Retail prices table reads that scrape log raw, so an unchanged price shows as 28 identical rows (14 per day across two days) instead of one row per merchant — the opposite of what the user guide promises ("currently known prices per merchant"). The hourly cadence also costs 24 feed fetches, D1 write batches, and R2 appends per day where one suffices for a price-comparison product, and `polling_interval_ms` in the merchant registry — the column that should own this decision — is never read by any scheduler.

One coordination constraint drives the threshold half of this change: the price staleness threshold is exactly 24 hours. With once-daily scraping, every offer ages past the threshold for part of each cycle, so the whole catalog would flicker STALE daily and the stale-price-share gauge would spike on schedule. The threshold must grow with the cadence, not after it.

## What Changes

### Registry-driven scrape cadence

- The hourly scheduling tick stays (`0 * * * *`, both the api-worker queue producer and the BullMQ scheduler). Each merchant is enqueued only when its registry `polling_interval_ms` interval boundary was crossed since the previous tick — state-free bucket comparison, idempotent under the existing hourly dedupe key.
- Merchants kept at 3,600,000 ms keep exact current behavior. The alks (and alko) registry rows move to 86,400,000 ms: once daily, at the first tick after 00:00 UTC (night in both DE and FI). Sub-hourly intervals are out of scope.
- The `polling_interval_ms` column becomes live configuration: cadence changes per merchant need a registry edit, not a deploy.

### Price staleness threshold 24 h → 48 h

- `DEFAULT_STALENESS_THRESHOLDS.price` doubles. With a 24 h cadence, an offer goes STALE only after two consecutive missed runs; scheduling jitter can no longer flip the catalog STALE daily.

### Product detail shows the current offer per merchant

- `findOffers` (D1 and Drizzle) returns the latest row per (product, merchant) instead of every scrape row. The Retail prices table shows one row per merchant — current price, last-observed date — as documented.
- No write-side change: `retail_offers` stays append-per-scrape (it carries the freshness axis), the observation log stays change-only (already correct), existing duplicate rows stay (reads collapse them; growth drops to one row per merchant per day).

## Non-goals (this change)

- No true-upsert/mutation of `retail_offers`: updating rows in place would destroy the per-scrape freshness record the staleness model relies on.
- No retroactive cleanup of existing duplicate rows; collapsed reads make them invisible.
- No change to `price_observations`, the recorder hook, summaries, or the history chart.
- No availability tracking, no sub-hourly cadence, no interval-phase offsets (daily runs align to UTC midnight buckets).
- No cron-pattern change in wrangler.jsonc — the tick cadence is unchanged.

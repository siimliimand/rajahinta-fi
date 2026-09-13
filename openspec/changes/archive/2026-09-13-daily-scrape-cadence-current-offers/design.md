# Design: daily scrape cadence and current-offer views

## D1 — Cadence gate: interval buckets, no state

The producer keeps its hourly tick. On each tick, for each permitted merchant with a feed URL:

```
bucket(now) = floor(now / pollingIntervalMs)
enqueue when bucket(now) !== bucket(now - 1 tick)
```

- A 24 h interval fires at the first tick after 00:00 UTC; 6 h fires at 00/06/12/18 UTC; 1 h reproduces today's behavior exactly. Any interval ≥ 1 h fires exactly once per interval regardless of tick jitter (a missed or late tick self-heals on the next hour, and the hourly dedupe key `price-ingestion-<merchant>-<YYYY-MM-DD-HH>` keeps the idempotency guarantee).
- Rejected: `last_enqueued_at` column + elapsed-time check — needs a schema migration, read-modify-write race handling in the producer, and a clock anchor; buys only arbitrary phase offsets (e.g. 03:17), which nobody asked for. Epoch-aligned buckets are deterministic and testable as a pure function.
- Rejected: changing the cron pattern to `0 3 * * *` — one global slot, per-merchant cadence impossible, and both the wrangler config and the BullMQ `@Cron` constant would need synchronized edits for every future change.
- Both hosts get the same gate: `schedulePriceIngestions` (api-worker producer) and `schedulePriceIngestion` (BullMQ `JobsSchedulerService`). The pair already mirrors each other (governance gate, dedupe key shape); the interval gate is the third mirrored behavior. The gate is one shared-shaped pure function per host, unit-tested with synthetic clocks.
- Sub-hourly intervals cannot be honored by an hourly tick — documented minimum is 3,600,000 ms. Registry rows are operator-controlled via the ops console, so no runtime validation is added; the seed and runbook state the minimum.

## D2 — Price staleness threshold 48 h

`assessDataRecency` marks STALE when `age > threshold`. With cadence C and threshold T, worst-case age just before a successful run approaches C (+ jitter). Today T = 24 h = C is a boundary collision: any delay flips every offer STALE for the tail of each cycle, and `stalePriceShareOf` / the freshness alert spike on schedule.

T = 2C = 48 h gives one full missed run of margin: a single failed or skipped daily run keeps the catalog VERIFIED; two consecutive misses (a real outage) triggers staleness honestly. Transport (7 d) and classification (30 d) thresholds are untouched. The threshold lives in `DEFAULT_STALENESS_THRESHOLDS` (core-domain, pure constant) — callouts to re-verify: data-quality service tests and the freshness-alert cron expectations that may pin 24 h.

## D3 — Current-offer collapse is read-side only

`findOffers` adds "latest row per (product, merchant)" semantics, latest = max(`observed_at`, `id`) — the same deterministic ordering `upsertOffer` change detection already uses, so the row the collapse keeps is exactly the row the recorder treats as current.

- D1 (SQLite): join `retail_offers` against `SELECT merchant, max(id) FROM retail_offers WHERE product_id = ? GROUP BY merchant` — `id` is monotonic, so max(id) per merchant is the latest observation without a window-function dependency.
- Drizzle/pg: same shape via the max-id sub-query (portable; `DISTINCT ON` rejected to keep both backends on one idiom).
- Caller audit — every `findOffers` consumer wants current offers, and dedup cannot change their results except by removing superseded rows:
  - product detail (search route + Nest controller): the Retail prices table — the point of the change; `offers.length` becomes the per-merchant count, matching the documented "28 offers" → "N merchants" semantics.
  - `lowestCurrentOfferPriceCents`: min over identical-priced duplicates equals min over the deduped set.
  - unit-price embeds, price-context, group-order `resolveUnitValues`: read current prices per merchant; duplicates were already same-merchant same-price noise.
  - calculator `findRetailOffers` (Alko newest-reference selection): picks the newest offer itself; a deduped input is a subset with the same newest row.
- Rejected: true upsert (UPDATE in place) — destroys the per-scrape freshness record; the staleness model and the observation log's "no availability" contract both lean on scrape rows existing per check. Rejected: write-side skip of unchanged prices — same failure, the freshness axis dies (explored and discarded in the session that produced this change).
- Existing duplicate rows are left in place: reads collapse them, and at one scrape per merchant per day the table grows ~365 rows/product/merchant/year — acceptable for MVP; a retention extension can prune superseded rows later.

## D4 — What deliberately does not change

`price_observations` already records only on price movement (`OfferChangeRecorderHook` gated on `upsertOffer.changed`) — the user's original instinct is implemented one layer down. The history chart reads materialized summaries, not the scrape log, and is untouched. wrangler.jsonc crons are untouched.

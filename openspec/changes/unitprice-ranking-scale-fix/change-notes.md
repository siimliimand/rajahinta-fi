# Change notes — unitprice-ranking-scale-fix

## Data-hygiene verdict (production retail_offers)

Date: 2026-10-03 · Method: read-only `wrangler d1 execute DB --remote --env production --command "<SELECT>" --json` (wrangler 4.127.1, database `rajahinta-api-production`, EU jurisdiction). Every query was a plain SELECT; each response envelope reported `changed_db: false`, `rows_written: 0`. No writes, no schema changes, no cleanup applied.

### Verdict: NO orphans — the earlier 8,699 was a misread bucket COUNT, not a bucket size

There is no orphan-offer problem. `product_id 2425` really does hold the largest bucket, and it holds **77** rows, exactly as the joined aggregate showed. The "one `product_id` bucket of 8,699 rows" figure was an artifact of reading the scalar produced by

```sql
SELECT COUNT(*) AS n FROM (SELECT COUNT(*) AS n FROM retail_offers GROUP BY product_id)
```

That query counts **how many GROUP BY buckets exist** — i.e. the number of distinct `product_id`s — and was mislabeled as `MAX(n)`. It is the bucket *count*, not the bucket *size*. One query settles both numbers side by side (production, 2026-10-03):

| metric                | value |
| --------------------- | ----- |
| bucket_count (distinct product_ids) | **8,699** |
| max_bucket_size       | **77** |
| min_bucket_size       | 1     |

The earlier AVG of 11.04 offers/product corroborates this: 96,022 / 8,699 = 11.04. If any single bucket held 8,699 of 96,022 rows, the arithmetic and the top-N ordering could not both look like this.

### Production numbers (all read via --remote, 2026-10-03)

- `retail_offers` total rows: **96,022**; distinct `product_id`s: **8,699**; `product_master` rows: **8,700**.
- Top 5 raw buckets (`GROUP BY product_id ORDER BY n DESC LIMIT 5`): 2425→77, 2398→77, 2360→76, 2230→76, 2702→61.
- Top 3 buckets after `JOIN product_master` (live products only): 2425→77, 2398→77, 2360→76 — identical to the raw top 3. The join "cap at 77" is not a cap at all: the largest bucket belongs to live product 2425.
- Orphan census (`LEFT JOIN product_master pm ON pm.id = o.product_id WHERE pm.id IS NULL`): **orphan_rows = 0, orphan_products = 0**. Every `retail_offers.product_id` resolves to a `product_master` row.
- Full reconciliation of the two counts: master (8,700) = referenced products (8,699) + exactly one master row with zero offers. No id dangles in either direction that matters for ranking (a master product without offers simply produces no candidate rows).

### Consequence for this change

- **No cleanup SQL artifact is required** — there are no orphan rows to delete, so no OWNER-REVIEW DELETE is issued. Nothing was auto-applied; nothing needs applying.
- The real per-product offer skew is modest (max 77, AVG ~11), which confirms the task 1.1 single-JOIN candidate query operates on a sane distribution rather than one pathological 8,699-row bucket.
- The `retail_offers(product_id, merchant, id)` index from task 1.2 remains justified: the top-bucket query above currently reads ~200k rows per evaluation without it.

## Production handover — sequencing and live checks

Date: 2026-10-03 · Scope: unitprice-ranking-scale-fix (single-JOIN ranking read model + migration 0025 + frontend fetch timeout). Written before deploy; the live checks below are the post-deploy acceptance steps.

### 1. Sequencing — merge does NOT deploy

Merging this branch to `master` only lands the code. Production deploy is the owner-gated workflow_dispatch:

```bash
gh workflow run deploy-production.yml --repo siimliimand/rajahinta-fi --ref master -f confirm_deploy=yes
```

Any other `confirm_deploy` value (or omission) aborts the run before any job executes. In the run log, confirm the **"Apply D1 migrations (production)"** job applied `0025_retail_offers_product_merchant_id_idx` (the migrations step lists each applied filename; 0025 must appear exactly once, on this run). If the job reports 0025 as already applied on a re-run, that is also fine — `CREATE INDEX IF NOT EXISTS` keeps a stray re-apply a no-op.

### 2. No data backfill is needed

This change is a read-model fix plus one index. It introduces no new columns, no new tables, and no new persisted state — everything it needs is already inside `retail_offers` + `product_master`. **Do not invent or run any backfill** for this change; there is nothing to backfill.

### 3. Live checks (post-deploy)

Latency per category — expect `200` in well under 1 s for each (dead baseline, pre-fix: wine_still hit the ~100 s edge cutoff, beer ~19 s):

```bash
for cat in beer wine_still spirits; do
  curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" \
    -H "x-age-confirmed: 1" \
    "https://api.rajahinta.fi/api/v1/unitprice/ranking?category=${cat}"
done
```

Ordering spot-check on one category — prints `true` iff rows are ascending by `centsPerGram` with ascending `productId` as the tiebreak (exits 1 otherwise):

```bash
curl -s -H "x-age-confirmed: 1" \
  "https://api.rajahinta.fi/api/v1/unitprice/ranking?category=beer" \
  | jq -e '.items == (.items | sort_by(.centsPerGram, .productId))'
```

`/value` page — `curl -sL https://www.rajahinta.fi/value` should return the rendered shell (HTTP 200), but the ranking table itself is client-fetched, so the real check is in a browser: open `/value`, pick a category, and confirm the table fills with rows within a few seconds. On fetch failure the page shows the error state with a retry button within 10 s (the task 3.1 abort) rather than spinning forever. No headless browser was available in this session, so the browser-side fill was not exercised pre-handover — it is explicitly part of these post-deploy checks.

### 4. Rollback

- **Workers:** `npx wrangler rollback` (in `apps/api-worker`, production env) reverts the API to the previous deployment. The frontend is deployed separately (OpenNext via its own workflow) and can be reverted the same way if ever needed.
- **Index:** migration 0025 is additive — old code on the new schema works unchanged. If the index itself ever needs to go, it is a separate owner-gated statement, not a migration rollback:
  `DROP INDEX IF EXISTS retail_offers_product_merchant_id_idx`
- **Independence:** code and index are independent — old code on new schema works; new code wants the index for speed but is correct without it. There is no ordering constraint between a code rollback and index removal.

### 5. Next-day watch

Nothing new. The daily cron does not interact with this change beyond `retail_offers` growing as usual — which is exactly what the 0025 index now bounds: the ranking query's cost scales with the category's product/offer set through the index, not with full-table scans. Standard freshness dashboards apply.

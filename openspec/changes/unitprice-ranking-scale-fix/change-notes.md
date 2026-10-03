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

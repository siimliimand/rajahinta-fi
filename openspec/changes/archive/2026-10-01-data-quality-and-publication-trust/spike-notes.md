# Spike notes — cross-feed near-dupe collapse candidates

Change: `data-quality-and-publication-trust`, task 5.3 (design D5: dedupe ships as a spike, not a feature).
Date: 2026-09-30.
Status: **queries written, NOT executed** — this sandbox is not authenticated for the Cloudflare account (`npx wrangler whoami` → "You are not authenticated. Please run `wrangler login`"). Every number below is a `TBD (operator run)` placeholder. All queries are **read-only SELECTs** against the production D1 database; nothing here writes, alters, or deletes.

## 1. Question

How many **published product rows** would collapse under two exact-key strategies?

- **(a) exact EAN match** — `product_master.ean` equal (non-null) across rows.
- **(b) brand+volume+ABV tuple match** — `(brand, unit_volume, alcohol_by_volume)` all present and all equal across rows.

"Published" = every `product_master` row. The table has no DRAFT/PUBLISHED lifecycle column (that lifecycle exists for ferry_offers, producer_links, curated_entries, blog_posts — not products); the public products API reads all of `product_master`, so row count is the published denominator. If a future dedupe change introduces a held-for-review state, this denominator changes and the spike should be re-run.

**Boundary (design D5):** these are EXACT keys only. No similarity scoring, no fuzzy matching, no name comparison is proposed or measured here. The "no similarity scoring" isolation boundary is a spec decision; the change that would cross it needs its own proposal grounded in the numbers this spike collects.

Motivating observations from the 2026-09-30 evidence walk (proposal Why):

- Karhu listed **3× as near-duplicates** (plus the "Karhu Olut 5.3% 24×33 l" typo, handled separately by this change's volume gates — not a dedupe concern).
- Jameson listed in **16 variants**.
- Bundles like "…+ Jägermeister 0" parsed as products.

## 2. Schema facts the queries rely on

From `packages/data-platform/src/d1/schema.ts` (D1 = SQLite, snake_case):

- `product_master`: `id`, `name`, `manufacturer`, `brand`, `category`, `alcohol_by_volume` (REAL, **nullable**), `unit_volume` (REAL, NOT NULL, litres), `container_type`, `ean` (TEXT(13), **nullable**, no unique constraint), `created_at`, `updated_at`.
- `retail_offers`: `id`, `merchant` (e.g. "alko", "eu-import"), `country`, `product_id` (FK → product_master), `price_cents`, `observed_at`, `reliability_status`.

Consequences for the two strategies:

- **(a) is blind to EAN-less rows.** Any row with `ean IS NULL` can never collapse under (a), no matter how obviously duplicated.
- **(b) is blind to incomplete tuples.** `unit_volume` is NOT NULL by schema, but `alcohol_by_volume` is nullable — a NULL ABV removes the row from every (b) group. SQLite `GROUP BY` treats NULLs as equal, so an unguarded query would falsely collapse all NULL-ABV rows of a brand into one group; every (b) query below filters `alcohol_by_volume IS NOT NULL`.
- **(b) compares REAL values exactly.** Cross-feed representation drift (ABV stored as `0.047` vs `4.7`, volume as `0.33` vs `0.330`) would split true duplicates into separate groups. Exact equality is the honest measurement of the proposed key; representation normalization is itself a decision the future change must own.

## 3. Worked examples

### 3.1 Jameson — 16 variants

The evidence walk found 16 Jameson rows. Three sub-populations are possible, and the two strategies treat each differently:

| Sub-population | (a) exact EAN | (b) brand+volume+ABV |
|---|---|---|
| Same SKU re-listed per feed, EAN present and equal | ✅ collapses | ✅ collapses (also matches on tuple, if ABV populated) |
| Genuinely distinct SKUs (Original vs 18yo vs Black Barrel, 700 ml vs 1 l), each with its own EAN | ❌ stays split — correct | ⚠️ **false collapse** where volume and ABV coincide: Jameson Original 700 ml 40% and Jameson 18yo 700 ml 40% share the tuple `(Jameson, 0.7, 0.4)` but are different products with different prices |
| Same SKU re-listed but EAN missing in one feed's rows | ❌ stays split — (a) is invisible to EAN-less rows | ✅ collapses if ABV present on all copies |

So the 16 rows decompose into "same bottle listed twice" (both strategies want to collapse) and "different bottles" (neither should). The tuple cannot tell the two apart whenever size and ABV coincide across the product line; the EAN can, but only where the barcode exists. Queries R8–R10 return the actual decomposition.

Edge case both strategies miss here: a bundle row ("Jameson + gift box") may carry the real bottle's EAN or a parseable first-token brand, collapsing a bundle with the genuine product. This change's bundle-rejection gate (task 1.4) must land and sweep before any collapse key is trusted over production data.

### 3.2 Karhu — 3 near-duplicate rows

Three Karhu rows observed as near-duplicates. How each strategy collapses them depends on two field-level facts the lookup (R11–R12) returns per row:

- **If all three share one EAN** → (a) collapses all 3 into one group. If two share an EAN and the third is EAN-less (typical for WooCommerce feeds without barcodes) → (a) collapses 2 and the third row is invisible to the rule; the duplicate survives the collapse.
- **If all three have ABV populated and equal** (Karhu 5.3%, same unit volume) → (b) collapses all 3. If one of the three has NULL ABV → (b) collapses only the complete-tuple members and strands the NULL row — the group silently holds 2 of 3.

The Karhu case is the clean demonstration of each strategy's failure mode: (a) fails on missing identifier, (b) fails on missing attribute. Note also the adjacent case that must NOT collapse: Karhu 4.7% 0.33 l vs Karhu 5.3% 0.33 l differ in the tuple and stay split — (b) is not fooled by ABV, which is its main virtue over name matching.

### 3.3 Bundle rows ("…+ Jägermeister 0")

Bundles parsed as products are a contamination source for both keys: a bundle row inheriting the first product's EAN merges two listings under (a); a bundle whose parsed brand/volume/ABV equal the standalone product merges under (b). The spike measures the catalog as it is today — including such rows — so group counts are upper bounds, and the future change should sequence dedupe after this change's gates have swept the implausible rows.

## 4. Queries (read-only)

Database: `rajahinta-api-production` (id `f8f67277-5046-46fc-9144-4342ab7af003`, per `apps/api-worker/wrangler.jsonc` env `production`). Run form:

```
npx wrangler d1 execute rajahinta-api-production --remote --command "<SQL below>" --json
```

All statements are single SELECTs — no `INSERT`/`UPDATE`/`DELETE`/`ALTER`/`CREATE` appears anywhere. `--remote` targets production; omitting it would query a throwaway local SQLite and print misleading zeros. If shell quoting gets awkward, paste a statement into a temp `.sql` file and run `npx wrangler d1 execute rajahinta-api-production --remote --file <file> --json -y`.

### R1 — Baseline (the published denominator and both strategies' blind spots)

```
SELECT
  (SELECT COUNT(*) FROM product_master)                                AS total_products,
  (SELECT COUNT(*) FROM product_master WHERE ean IS NOT NULL)          AS products_with_ean,
  (SELECT COUNT(*) FROM product_master WHERE alcohol_by_volume IS NULL) AS products_without_abv,
  (SELECT COUNT(DISTINCT merchant) FROM retail_offers)                 AS distinct_merchants;
```

**Result: TBD (operator run)**

### R2 — Cross-feed exposure (products offered by more than one merchant)

```
SELECT COUNT(*) AS products_on_multiple_merchants
FROM (
  SELECT product_id FROM retail_offers
  GROUP BY product_id
  HAVING COUNT(DISTINCT merchant) > 1
);
```

**Result: TBD (operator run)** — the population a *cross-feed* dedupe rule can actually touch; collapsing rows that only ever appeared under one merchant changes nothing a customer sees.

### R3 — Strategy (a): duplicate-EAN groups

```
SELECT COUNT(*) AS dup_ean_groups,
       COALESCE(SUM(group_size), 0) AS products_in_dup_groups
FROM (
  SELECT ean, COUNT(*) AS group_size
  FROM product_master
  WHERE ean IS NOT NULL
  GROUP BY ean
  HAVING COUNT(*) > 1
);
```

**Result: TBD (operator run)**

### R4 — Strategy (a): group-size distribution

```
SELECT group_size, COUNT(*) AS groups_of_this_size
FROM (
  SELECT ean, COUNT(*) AS group_size
  FROM product_master
  WHERE ean IS NOT NULL
  GROUP BY ean
  HAVING COUNT(*) > 1
)
GROUP BY group_size
ORDER BY group_size;
```

**Result: TBD (operator run)** — a long tail of huge groups (> ~10 rows per EAN) is the signature of generic or feed-side placeholder barcodes and must be reviewed before any auto-collapse.

### R5 — Strategy (a): cross-merchant duplicate-EAN groups

```
SELECT COUNT(*) AS cross_merchant_ean_groups
FROM (
  SELECT pm.ean
  FROM product_master pm
  JOIN retail_offers ro ON ro.product_id = pm.id
  WHERE pm.ean IS NOT NULL
  GROUP BY pm.ean
  HAVING COUNT(DISTINCT ro.merchant) > 1
);
```

**Result: TBD (operator run)**

### R6 — Strategy (b): duplicate tuple groups

```
SELECT COUNT(*) AS dup_tuple_groups,
       COALESCE(SUM(group_size), 0) AS products_in_dup_groups
FROM (
  SELECT brand, unit_volume, alcohol_by_volume, COUNT(*) AS group_size
  FROM product_master
  WHERE alcohol_by_volume IS NOT NULL
  GROUP BY brand, unit_volume, alcohol_by_volume
  HAVING COUNT(*) > 1
);
```

**Result: TBD (operator run)** — `brand` is compared as stored (the DataMappingService's output); no extra normalization is applied, because normalization would be part of the future change's key definition, not of this measurement.

### R7 — Strategy (b): group-size distribution

```
SELECT group_size, COUNT(*) AS groups_of_this_size
FROM (
  SELECT brand, unit_volume, alcohol_by_volume, COUNT(*) AS group_size
  FROM product_master
  WHERE alcohol_by_volume IS NOT NULL
  GROUP BY brand, unit_volume, alcohol_by_volume
  HAVING COUNT(*) > 1
)
GROUP BY group_size
ORDER BY group_size;
```

**Result: TBD (operator run)**

### R8 — Strategy (b): cross-merchant duplicate tuple groups

```
SELECT COUNT(*) AS cross_merchant_tuple_groups
FROM (
  SELECT pm.brand, pm.unit_volume, pm.alcohol_by_volume
  FROM product_master pm
  JOIN retail_offers ro ON ro.product_id = pm.id
  WHERE pm.alcohol_by_volume IS NOT NULL
  GROUP BY pm.brand, pm.unit_volume, pm.alcohol_by_volume
  HAVING COUNT(DISTINCT ro.merchant) > 1
);
```

**Result: TBD (operator run)**

### R9 — Jameson: the 16 rows, with each strategy's grouping columns visible

```
SELECT pm.id, pm.name, pm.brand, pm.manufacturer, pm.category,
       pm.alcohol_by_volume, pm.unit_volume, pm.container_type, pm.ean,
       (SELECT COUNT(*) FROM retail_offers ro WHERE ro.product_id = pm.id)            AS offer_count,
       (SELECT COUNT(DISTINCT ro.merchant) FROM retail_offers ro WHERE ro.product_id = pm.id) AS merchant_count
FROM product_master pm
WHERE lower(pm.brand) LIKE '%jameson%' OR lower(pm.name) LIKE '%jameson%'
ORDER BY pm.ean, pm.unit_volume, pm.alcohol_by_volume, pm.id;
```

**Result: TBD (operator run)** — read the rows against §3.1's table: which copies share an EAN, which share the tuple, which EANs/ABVs are NULL.

### R10 — Jameson under strategy (a): EANs shared within the Jameson rows

```
SELECT pm.ean, COUNT(*) AS jameson_rows_with_this_ean
FROM product_master pm
WHERE (lower(pm.brand) LIKE '%jameson%' OR lower(pm.name) LIKE '%jameson%')
  AND pm.ean IS NOT NULL
GROUP BY pm.ean
HAVING COUNT(*) > 1;
```

**Result: TBD (operator run)**

### R11 — Jameson under strategy (b): tuples shared within the Jameson rows

```
SELECT pm.brand, pm.unit_volume, pm.alcohol_by_volume, COUNT(*) AS jameson_rows_with_this_tuple
FROM product_master pm
WHERE (lower(pm.brand) LIKE '%jameson%' OR lower(pm.name) LIKE '%jameson%')
  AND pm.alcohol_by_volume IS NOT NULL
GROUP BY pm.brand, pm.unit_volume, pm.alcohol_by_volume
HAVING COUNT(*) > 1;
```

**Result: TBD (operator run)** — each returned tuple groups ≥2 of the 16; cross-check the tuple members' names (R9) to count false collapses (different Jameson expressions sharing size and ABV).

### R12 — Karhu: the 3 rows, same columns

```
SELECT pm.id, pm.name, pm.brand, pm.manufacturer,
       pm.alcohol_by_volume, pm.unit_volume, pm.container_type, pm.ean,
       (SELECT COUNT(*) FROM retail_offers ro WHERE ro.product_id = pm.id)            AS offer_count,
       (SELECT COUNT(DISTINCT ro.merchant) FROM retail_offers ro WHERE ro.product_id = pm.id) AS merchant_count
FROM product_master pm
WHERE lower(pm.brand) LIKE '%karhu%' OR lower(pm.name) LIKE '%karhu%'
ORDER BY pm.brand, pm.unit_volume, pm.alcohol_by_volume, pm.id;
```

**Result: TBD (operator run)** — §3.2's two questions answer themselves from these rows: do the three share an EAN? do all three have ABV populated?

## 5. Findings

**None recorded — the spike did not execute against production** (no Cloudflare credentials in this environment; see Status above). Every result slot above is a `TBD (operator run)` placeholder. Fill them by running R1–R12 in order with the command form from §4; each is independent, so partial runs are fine. The worked-example reads (R9–R12) are the highest-value runs: they turn the two anecdotes into exact per-strategy outcomes and take minutes.

Interpretation guide once numbers land (not findings themselves):

- If **R5 ≫ 0 with sane group sizes in R4**, exact-EAN collapse has real reach across feeds and the risk concentrates in a reviewable handful of large groups.
- If **R2 is small**, most duplication is within-feed and the future change is closer to an ingestion-idempotency fix than a cross-feed merge.
- If **R8's groups mostly contain exactly one distinct product name** (checkable on a sample), the tuple is safer than its reputation; every multi-name group is a documented false-collapse candidate like §3.1's 18yo case.
- If **R1 shows `products_without_ean` or `products_without_abv` dominating**, the honest headline is that neither key can see most of the catalog, and the future change's first move is identifier coverage (the Alko EAN join hit-rate recorded in this change's data-landing task is the same measurement).

## 6. Recommended spec decision (for the future dedupe change's proposal)

**(a) exact EAN** should become a collapse rule only if R3/R5 show a non-trivial number of groups whose rows agree on more than the barcode — same unit volume, same category — and if R4 shows group sizes concentrated at 2–3, because the EAN's failure mode is a shared or mis-entered barcode collapsing distinct SKUs (multipack family EANs, merchant-internal codes) silently and with total confidence. The natural shape is: collapse on equal non-null EAN **plus** at least one corroborating attribute (volume), route large groups (> ~10 rows, per R4) and checksum-failing EANs to a review queue instead of auto-merging. EAN is the only key here that identifies the product rather than describing it, so where it exists it should outrank (b); its blind spot is purely coverage, which is an ingestion-data problem (capture the barcode) rather than a matching problem.

**(b) brand+volume+ABV** should be proposed, at most, as a **candidate generator that feeds review — not an auto-collapse** — unless R8 shows cross-merchant tuple groups whose members are demonstrably the same product (one distinct name per group) at a rate that makes the exceptions negligible. Its structural defect is the one the 16-Jameson case exhibits: the tuple describes a slot in a product line ("Jameson, 700 ml, 40%") and cannot distinguish expressions occupying the same slot, so it collapses the true duplicate and the neighbouring expression identically. It also strands every NULL-ABV row and every representation-drifted value (0.047 vs 4.7). The defensible middle is: exact tuple equality + single-distinct-`name`-per-group as the auto rule, everything else surfaced for human confirmation — which keeps the change inside exact-key matching (D5's boundary) while refusing to guess where the tuple is ambiguous. If the numbers show neither strategy reaches enough of the catalog (R1's blind-spot counts), the right recommendation to the future change is sequencing: fix identifier coverage first, re-run this spike, and only then pick the collapse rule — deduping on keys that see 30% of the catalog dedupes 30% of the problem.

No implementation is proposed here (design D5); these paragraphs are the input to that future change's own proposal.

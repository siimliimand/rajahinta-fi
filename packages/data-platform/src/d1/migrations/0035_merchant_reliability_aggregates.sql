-- Task 1.1 (change merchant-reliability-materialized-aggregates): the
-- 2026-10 D1 billing incident's layer-2 fix. The product-page reliability
-- embed recomputed these per-merchant whole-catalog aggregates on every
-- request (~818k rows/read measured; PR #129's merchant-bounded variant
-- still cost 534k) even though the figures change at most once per
-- 30-minute aggregation tick. Materialized here, the per-request read
-- becomes a primary-key lookup over a handful of rows; the tick (task 2.1)
-- re-runs this same INSERT .. SELECT as its full refresh, so this one-off
-- ~818k-row read at deploy is the last per-figure whole-catalog scan.
--
-- One row per merchant holding at least one current offer, where
-- "current" is the deterministic-latest rule the repositories run today:
-- the latest retail_offers row per (merchant, product_id) by
-- (observed_at, id) DESC — the SQLite ROW_NUMBER() translation of the pg
-- DISTINCT ON query. The seeded rows ARE the live aggregate, byte for
-- byte. The ESTIMATED bucket is anything not exactly VERIFIED, STALE or
-- UNAVAILABLE (NULL-safe `IS NOT`, the repository's degrade-don't-
-- overstate rule); the four CASE arms partition every ranked row.
--
-- computed_at is the migration execution moment in the repository's
-- ISO-8601 serialization shape (strftime %f renders SS.sss, matching
-- Date.toISOString()). Because the arms partition, the four status
-- counts sum to offer_count for every writer that uses this aggregate —
-- the table's defining invariant, CHECK-enforced so it is unrepresentable
-- at rest to store figures that violate it. A blank merchant is equally
-- unrepresentable: aggregates exist only for retail_offers.merchant
-- values, which are non-empty.
CREATE TABLE `merchant_reliability_aggregates` (
	`merchant` text(128) PRIMARY KEY NOT NULL,
	`offer_count` integer NOT NULL,
	`verified_count` integer NOT NULL,
	`estimated_count` integer NOT NULL,
	`stale_count` integer NOT NULL,
	`unavailable_count` integer NOT NULL,
	`freshest_observed_at` text NOT NULL,
	`computed_at` text NOT NULL,
	CONSTRAINT "merchant_reliability_aggregates_merchant_check" CHECK("merchant_reliability_aggregates"."merchant" <> ''),
	CONSTRAINT "merchant_reliability_aggregates_counts_sum_check" CHECK("merchant_reliability_aggregates"."verified_count" + "merchant_reliability_aggregates"."estimated_count" + "merchant_reliability_aggregates"."stale_count" + "merchant_reliability_aggregates"."unavailable_count" = "merchant_reliability_aggregates"."offer_count")
);
--> statement-breakpoint
INSERT INTO `merchant_reliability_aggregates` (
	`merchant`,
	`offer_count`,
	`verified_count`,
	`estimated_count`,
	`stale_count`,
	`unavailable_count`,
	`freshest_observed_at`,
	`computed_at`
)
WITH ranked AS (
	SELECT merchant, reliability_status, observed_at,
	       ROW_NUMBER() OVER (
	         PARTITION BY merchant, product_id
	         ORDER BY observed_at DESC, id DESC
	       ) AS rn
	  FROM retail_offers
)
SELECT merchant,
       COUNT(*) AS offer_count,
       SUM(CASE WHEN reliability_status = 'VERIFIED' THEN 1 ELSE 0 END)
         AS verified_count,
       SUM(CASE WHEN reliability_status IS NOT 'VERIFIED'
                 AND reliability_status IS NOT 'STALE'
                 AND reliability_status IS NOT 'UNAVAILABLE'
                THEN 1 ELSE 0 END)
         AS estimated_count,
       SUM(CASE WHEN reliability_status = 'STALE' THEN 1 ELSE 0 END)
         AS stale_count,
       SUM(CASE WHEN reliability_status = 'UNAVAILABLE' THEN 1 ELSE 0 END)
         AS unavailable_count,
       MAX(observed_at) AS freshest_observed_at,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS computed_at
  FROM ranked
 WHERE rn = 1
 GROUP BY merchant
 ORDER BY merchant ASC;
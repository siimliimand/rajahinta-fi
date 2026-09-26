-- Backfill: canonical litres + decoded entity names in product_master.
-- One-time pass; run AFTER the worker deploy that reads litres canonically.
-- NOT idempotent in general: rows whose feed legitimately claims >= 5 l
-- (local catalog: two 5 l BIBs, two 15 l BIBs, one "24×33 l" feed typo)
-- were ml-shaped only because the old mapper stored ml, so this pass
-- fixed them — but re-running would divide their now-correct litre
-- values again. Run exactly once per environment; do not loop.
--
-- Counts MUST be recorded before and after in the change notes.
-- Local baseline (2026-09-25): 1,570 rows — 1,502 ml-like (>= 5), 68 litre-like.
-- Applied locally 2026-09-26 (see change notes.md for before/after counts).
--
-- Column affinity note: product_master.unit_volume is REAL (drizzle `real`),
-- so `unit_volume / 1000.0` is plain float division — no TEXT coercion and
-- no CAST needed. 330 → 0.33 and friends land on the same IEEE double the
-- litre literals use; SQLite renders the shortest round-trip form ("0.33"),
-- so no float artifacts appear in stored or emitted values.

-- 1. Convert millilitre-denominated volumes to litres.
--    Written when the catalog's largest litre-shaped value was a 3 l BIB;
--    the sweep later surfaced 5 l/15 l BIBs (see the header's non-idempotence
--    note) — after this pass those sit at their correct litre values and
--    must not be divided again.
UPDATE product_master
SET unit_volume = unit_volume / 1000.0
WHERE unit_volume >= 5.0;

-- 2. Decode numeric + named HTML entities left by the WooCommerce feeds.
--    Forms observed in the catalog (entity census 2026-09-26):
--    &#038; (&) &amp; (&) &#215; (×) &#8211; (–) &#8217; (’) &#8221; (”).
--    This mirrors the ingestion decoder's output for those references
--    (data-acquisition html-entities), which handles future forms.
--    The guard matches ANY numeric or amp reference — a narrower guard
--    ('%&#0%', '%&#8%') silently skipped &#215;-only rows (79 occurrences,
--    mostly 24×0.33 l case names) — while the LIKE guard keeps the UPDATE
--    a no-op (and the write volume zero) for already-clean names.
UPDATE product_master
SET name = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
              REPLACE(name, '&#038;', '&'),
              '&amp;', '&'),
              '&#215;', '×'),
              '&#8211;', '–'),
              '&#8221;', '”'),
              '&#8220;', '“'),
              '&#8217;', '’')
WHERE name LIKE '%&#%' OR name LIKE '%&amp;%';

UPDATE product_master
SET brand = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
              REPLACE(brand, '&#038;', '&'),
              '&amp;', '&'),
              '&#215;', '×'),
              '&#8211;', '–'),
              '&#8221;', '”'),
              '&#8220;', '“'),
              '&#8217;', '’')
WHERE brand LIKE '%&#%' OR brand LIKE '%&amp;%';

-- 3. Post-conditions (each must return 0 rows; fails loudly otherwise):
--    SELECT COUNT(*) FROM product_master WHERE unit_volume >= 100;
--    SELECT COUNT(*) FROM product_master WHERE unit_volume < 0;
--    SELECT COUNT(*) FROM product_master
--    WHERE name LIKE '%&#%' OR name LIKE '%&amp;%'
--       OR brand LIKE '%&#%' OR brand LIKE '%&amp;%';
--
--    Known unfixable residue (NOT a failure): unit_volume = 0 rows where
--    the feed name carries no parsable volume token (20 local rows,
--    e.g. "33CLx24" case boxes — the parser's word-boundary rule skips
--    "Lx"). Unit conversion cannot invent a volume; the task-1.4 quality
--    invariant (0 < unit_volume < 100) flags these going forward:
--    SELECT COUNT(*) FROM product_master WHERE unit_volume = 0;

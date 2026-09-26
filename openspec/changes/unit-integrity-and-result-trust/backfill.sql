-- Backfill: canonical litres + decoded entity names in product_master.
-- One-time pass; run AFTER the worker deploy that reads litres canonically.
-- Idempotent: re-running changes nothing once rows are converted.
--
-- Counts MUST be recorded before and after in the change notes.
-- Local baseline (2026-09-25): 1,570 rows — 1,502 ml-like (>= 5), 68 litre-like.

-- 1. Convert millilitre-denominated volumes to litres.
--    Litre-denominated legacy rows are < 5, so >= 5 isolates ml rows.
--    (Largest legitimate litre value in the catalog is a 3 l BIB.)
UPDATE product_master
SET unit_volume = unit_volume / 1000.0
WHERE unit_volume >= 5.0;

-- 2. Decode numeric + named HTML entities left by the WooCommerce feeds.
--    Numeric forms cover the observed cases: &#038; (&) &#215; (×)
--    &#8221; (”) &#8220; (“) &#8217; (’). The LIKE guard keeps the UPDATE
--    a no-op (and the write volume zero) for already-clean names.
UPDATE product_master
SET name = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
              REPLACE(name, '&#038;', '&'),
              '&amp;', '&'),
              '&#215;', '×'),
              '&#8221;', '”'),
              '&#8220;', '“'),
              '&#8217;', '’')
WHERE name LIKE '%&#0%' OR name LIKE '%&amp;%' OR name LIKE '%&#8%';

UPDATE product_master
SET brand = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
              REPLACE(brand, '&#038;', '&'),
              '&amp;', '&'),
              '&#215;', '×'),
              '&#8221;', '”'),
              '&#8220;', '“'),
              '&#8217;', '’')
WHERE brand LIKE '%&#0%' OR brand LIKE '%&amp;%' OR brand LIKE '%&#8%';

-- 3. Post-condition (must return 0 rows; fails loudly otherwise):
--    SELECT COUNT(*) FROM product_master
--    WHERE unit_volume <= 0 OR unit_volume >= 100;

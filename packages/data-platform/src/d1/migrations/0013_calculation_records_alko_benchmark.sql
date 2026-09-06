-- Task 4.2 (change drop-sweden-eur-only-alko-benchmark): the display-only
-- Alko benchmark persists with the calculation record when the calculation
-- had a usable Alko reference — JSON TEXT, the same jsonb-as-TEXT pattern
-- the breakdown and disclaimer columns use. Nullable forward migration:
-- reference-less and pre-change rows simply carry NULL; on the read path
-- NULL maps to an absent key, never a null or a placeholder.
ALTER TABLE `calculation_records` ADD COLUMN `alko_benchmark` TEXT;

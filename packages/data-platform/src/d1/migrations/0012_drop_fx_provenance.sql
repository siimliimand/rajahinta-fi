-- Task 2.1 (change drop-sweden-eur-only-alko-benchmark, design D3/D4):
-- the FX machinery is removed with the Systembolaget feed, so the
-- versioned-rate tables and the retail_offers conversion-provenance
-- columns are dropped forward-only (no down-migration; the removed data
-- has no future query path). The currency column STAYS — pinned to 'EUR'
-- by the data-quality invariant — so no second migration is needed.
--
-- Drop order matters under PRAGMA foreign_keys=ON: fx_rates references
-- fx_rate_datasets, so the child goes first.
--
-- Plain ALTER TABLE ... DROP COLUMN is safe here (design D4's rebuild
-- contingency is not needed): none of the three columns is indexed,
-- UNIQUE, or referenced by the table's CHECK/index definitions.
DROP TABLE `fx_rates`;--> statement-breakpoint
DROP TABLE `fx_rate_datasets`;--> statement-breakpoint
ALTER TABLE `retail_offers` DROP COLUMN `original_price_cents`;--> statement-breakpoint
ALTER TABLE `retail_offers` DROP COLUMN `original_currency`;--> statement-breakpoint
ALTER TABLE `retail_offers` DROP COLUMN `fx_dataset_version`;

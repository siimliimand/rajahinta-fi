-- Task 5.1 (change transport-confidence-unlock, design D7): the
-- attribution pair behind the operator verify-offer action — the human
-- write path that makes VERIFIED reachable at all ("ingestion never
-- self-certifies VERIFIED": every ingested offer is born ESTIMATED).
--
-- Nullable forward columns per the weight_grams precedent (0020): NULL
-- is the meaningful birth state of every offer, not missing data. The
-- pair is only ever written together by the console endpoint; there is
-- deliberately NO un-verify path that could NULL them back. Re-verify
-- overwrites the pair in place — the decision history lives in the
-- audit_events trail (one append per verification), not in these
-- columns, which carry only the latest attribution.
ALTER TABLE `retail_offers` ADD COLUMN `verified_at` text;--> statement-breakpoint
ALTER TABLE `retail_offers` ADD COLUMN `verified_by` text(128);

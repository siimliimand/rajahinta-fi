--> statement-breakpoint
-- Data migration: normalise tax_type values from legacy 'excise_duty' to 'excise'.
-- Task 2.2 (design D2): committed Drizzle data migration.
-- Idempotent: UPDATE with WHERE naturally is; repeated application is a no-op.
UPDATE tax_rules SET tax_type = 'excise' WHERE tax_type = 'excise_duty';
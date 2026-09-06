-- One-shot repair for staging D1 (rajahinta-api-staging): remap coarse
-- feed-style regulatoryClassification values to gate-known vocabulary.
-- Mirrors packages/data-platform/src/seed/d1/staging-fixtures.ts so the
-- live DB matches the seed source of truth. Food/tobacco/nicotine rows
-- intentionally keep non-member values (gate excludes non-alcohol goods).
UPDATE product_master SET regulatory_classification = category
WHERE regulatory_classification = 'alcoholic_beverage';

UPDATE product_master SET regulatory_classification = 'non-alcoholic'
WHERE regulatory_classification = 'non_alcoholic_beverage';

-- Verify: must return 0.
SELECT COUNT(*) AS bad_beverage_rows FROM product_master
WHERE regulatory_classification IN ('alcoholic_beverage', 'non_alcoholic_beverage');

-- Repair 2 for staging D1 (rajahinta-api-staging): ABV percent → fraction.
-- Domain contract (alcohol-excise.math validateRange 0–1): alcohol_by_volume
-- is a fraction (0.40 = 40 %). Fixture rows carried percent scale (40),
-- surfacing as 500 "abv must be between 0 and 1" once the classification
-- gate passed. Mirrors the corrected fixtures. NULL/0 rows untouched.
UPDATE product_master SET alcohol_by_volume = alcohol_by_volume / 100.0
WHERE alcohol_by_volume > 1;

-- Verify: must return 0.
SELECT COUNT(*) AS percent_scale_rows FROM product_master
WHERE alcohol_by_volume > 1;

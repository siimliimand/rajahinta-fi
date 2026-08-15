-- =============================================================================
-- Staging seed data — realistic Finnish tax-rule and merchant data
-- =============================================================================
-- Intended for the staging environment's independent Postgres copy.
-- Idempotent via TRUNCATE + INSERT (run through setup.sh).
--
-- Contains:
--   1. Tax rate versions (alcohol, tobacco, fuel — 2024/2025/2026 datasets)
--   2. Transport-rate reference data for common import routes
--   3. Sample merchants (5 varied profiles)
--   4. Sample products per merchant with offers
--   5. Golden dataset — pre-calculated scenarios for CI regression tests
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. TAX RATE VERSIONS
-- =============================================================================
-- Finnish excise rates sourced from Vero Skatt (Tax Administration) publications.
-- Alcohol rates in € per litre of pure alcohol (spirits) or € per litre (beer/wine).
-- Tobacco rates in € per 1000 pieces (cigarettes/cigars) or € per kg (fine-cut).
-- Fuel rates in € per 1000 litres.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Version 2024-01 — rates effective 2024-01-01
-- ---------------------------------------------------------------------------
INSERT INTO tax_rate_versions (version_label, effective_from, effective_to, confirmed_at, rates)
VALUES (
    '2024-01',
    '2024-01-01T00:00:00+02:00',
    '2024-12-31T23:59:59+02:00',
    '2023-12-15T10:00:00+02:00',
    '{
        "alcohol": {
            "spirits_per_litre_pure_alcohol_cents": 265500,
            "beer_strong_hectolitre_percent_cents": 3595,
            "beer_standard_hectolitre_percent_cents": 3050,
            "beer_low_hectolitre_cents": 0,
            "wine_still_hectolitre_cents": 0,
            "wine_sparkling_hectolitre_cents": 0,
            "intermediate_hectolitre_cents": 20300,
            "beer_abv_threshold_strong": 4.7,
            "beer_abv_threshold_low": 2.8
        },
        "tobacco": {
            "cigarettes_per_1000_cents": 64200,
            "cigarettes_ad_valorem_pct": 0.52,
            "cigars_per_1000_cents": 38500,
            "fine_cut_tobacco_per_kg_cents": 32500,
            "pipe_tobacco_per_kg_cents": 24500
        },
        "fuel": {
            "unleaded_petrol_per_1000l_cents": 73500,
            "diesel_per_1000l_cents": 62500,
            "ethanol_blend_per_1000l_cents": 55200,
            "bio_diesel_per_1000l_cents": 46000
        },
        "container_duty": {
            "plastic_bottle_cents": 0.15,
            "glass_bottle_cents": 0.10,
            "aluminium_can_cents": 0.15,
            "deposit_system_exempt": false
        },
        "metadata": {
            "source": "vero.fi/valmisteverotus",
            "currency": "EUR",
            "unit_system": "metric"
        }
    }'::jsonb
);

-- ---------------------------------------------------------------------------
-- Version 2025-01 — rates effective 2025-01-01 (index-adjusted +3.2%)
-- ---------------------------------------------------------------------------
INSERT INTO tax_rate_versions (version_label, effective_from, effective_to, confirmed_at, rates)
VALUES (
    '2025-01',
    '2025-01-01T00:00:00+02:00',
    '2025-12-31T23:59:59+02:00',
    '2024-12-10T14:30:00+02:00',
    '{
        "alcohol": {
            "spirits_per_litre_pure_alcohol_cents": 274200,
            "beer_strong_hectolitre_percent_cents": 3710,
            "beer_standard_hectolitre_percent_cents": 3150,
            "beer_low_hectolitre_cents": 0,
            "wine_still_hectolitre_cents": 0,
            "wine_sparkling_hectolitre_cents": 0,
            "intermediate_hectolitre_cents": 20950,
            "beer_abv_threshold_strong": 4.7,
            "beer_abv_threshold_low": 2.8
        },
        "tobacco": {
            "cigarettes_per_1000_cents": 66200,
            "cigarettes_ad_valorem_pct": 0.52,
            "cigars_per_1000_cents": 39700,
            "fine_cut_tobacco_per_kg_cents": 33500,
            "pipe_tobacco_per_kg_cents": 25300
        },
        "fuel": {
            "unleaded_petrol_per_1000l_cents": 75800,
            "diesel_per_1000l_cents": 64500,
            "ethanol_blend_per_1000l_cents": 56900,
            "bio_diesel_per_1000l_cents": 47400
        },
        "container_duty": {
            "plastic_bottle_cents": 0.15,
            "glass_bottle_cents": 0.10,
            "aluminium_can_cents": 0.15,
            "deposit_system_exempt": false
        },
        "metadata": {
            "source": "vero.fi/valmisteverotus",
            "currency": "EUR",
            "unit_system": "metric",
            "adjustment": "index_tarkistus_3.2pct"
        }
    }'::jsonb
);

-- ---------------------------------------------------------------------------
-- Version 2026-PROPOSAL — proposed rates for review cycle (task 2.2 test)
-- ---------------------------------------------------------------------------
-- This version is NOT yet confirmed — simulating a rule-change review.
-- It raises spirits duty +5% and adds a new e-liquid nicotine category.
INSERT INTO tax_rate_versions (version_label, effective_from, effective_to, confirmed_at, rates)
VALUES (
    '2026-PROPOSAL',
    '2026-01-01T00:00:00+02:00',
    NULL,
    NULL,
    '{
        "alcohol": {
            "spirits_per_litre_pure_alcohol_cents": 288000,
            "beer_strong_hectolitre_percent_cents": 3820,
            "beer_standard_hectolitre_percent_cents": 3245,
            "beer_low_hectolitre_cents": 0,
            "wine_still_hectolitre_cents": 0,
            "wine_sparkling_hectolitre_cents": 0,
            "intermediate_hectolitre_cents": 21580,
            "beer_abv_threshold_strong": 4.7,
            "beer_abv_threshold_low": 2.8
        },
        "tobacco": {
            "cigarettes_per_1000_cents": 68200,
            "cigarettes_ad_valorem_pct": 0.52,
            "cigars_per_1000_cents": 40900,
            "fine_cut_tobacco_per_kg_cents": 34500,
            "pipe_tobacco_per_kg_cents": 26000
        },
        "nicotine": {
            "e_liquid_per_ml_cents": 40,
            "nicotine_pouches_per_gram_cents": 25,
            "snus_per_kg_cents": 28000
        },
        "fuel": {
            "unleaded_petrol_per_1000l_cents": 78100,
            "diesel_per_1000l_cents": 66400,
            "ethanol_blend_per_1000l_cents": 58600,
            "bio_diesel_per_1000l_cents": 48800
        },
        "container_duty": {
            "plastic_bottle_cents": 0.18,
            "glass_bottle_cents": 0.12,
            "aluminium_can_cents": 0.18,
            "deposit_system_exempt": false
        },
        "metadata": {
            "source": "vero.fi/valmisteverotus",
            "currency": "EUR",
            "unit_system": "metric",
            "adjustment": "ehdotus_2026_lausuntokierros",
            "confirmed": false
        }
    }'::jsonb
);

-- =============================================================================
-- 2. TRANSPORT RATES
-- =============================================================================

INSERT INTO transport_rates (carrier_id, origin_country, destination_country, base_price_cents, price_per_kg_cents, min_weight_kg, max_weight_kg, effective_from, effective_to, reliability)
VALUES
    ('posti_freight',   'EE', 'FI', 2500,  0.85,  0.0,   50.0,  '2024-01-01T00:00:00+02:00', NULL, 'EXACT'),
    ('posti_freight',   'EE', 'FI', 4500,  0.65,  50.0,  500.0, '2024-01-01T00:00:00+02:00', NULL, 'EXACT'),
    ('dhl_fi',          'DE', 'FI', 3500,  1.20,  0.0,   30.0,  '2024-01-01T00:00:00+02:00', NULL, 'EXACT'),
    ('dhl_fi',          'DE', 'FI', 6500,  0.90,  30.0,  300.0, '2024-01-01T00:00:00+02:00', NULL, 'EXACT'),
    ('db_schenker',     'DE', 'FI', 5500,  0.75,  100.0, 2000.0,'2024-01-01T00:00:00+02:00', NULL, 'EXACT'),
    ('db_schenker',     'NL', 'FI', 5800,  0.78,  100.0, 2000.0,'2024-01-01T00:00:00+02:00', NULL, 'EXACT'),
    ('maersk_fi',       'CN', 'FI', 85000, 2.50,  500.0, 25000.0,'2024-01-01T00:00:00+02:00', NULL, 'EXACT'),
    ('maersk_fi',       'US', 'FI', 72000, 3.20,  500.0, 25000.0,'2024-01-01T00:00:00+02:00', NULL, 'EXACT'),
    ('vr_transport',    'SE', 'FI', 3200,  0.55,  0.0,   1000.0,'2024-01-01T00:00:00+02:00', NULL, 'EXACT'),
    ('vr_transport',    'SE', 'FI', 5200,  0.40,  1000.0,10000.0,'2024-01-01T00:00:00+02:00', NULL, 'EXACT'),
    ('dsv_fi',          'IT', 'FI', 4200,  1.10,  0.0,   50.0,  '2024-01-01T00:00:00+02:00', NULL, 'EXACT'),
    ('kaukokiito',      'EE', 'FI', 1800,  0.50,  0.0,   100.0, '2024-01-01T00:00:00+02:00', NULL, 'ESTIMATED');

-- =============================================================================
-- 3. MERCHANTS
-- =============================================================================
-- Merchant IDs are stable short strings used throughout the system.

-- ---------------------------------------------------------------------------
-- Merchant: HelsinkiPremium Oy — Large alcohol importer
-- ---------------------------------------------------------------------------
INSERT INTO products (name, brand, container_type, volume_litres, alcohol_by_volume, ean)
VALUES
    ('Koskenkorva Viina',        'Koskenkorva',   'bottle', 0.700, 38.000, '6410600010101'),
    ('Koskenkorva Salmiakki',    'Koskenkorva',   'bottle', 0.500, 32.000, '6410600010118'),
    ('Absolut Vodka',            'Absolut',       'bottle', 0.700, 40.000, '7312040017306'),
    ('Absolut Original',        'Absolut',       'bottle', 1.000, 40.000, '7312040017313'),
    ('Jameson Irish Whiskey',    'Jameson',       'bottle', 0.700, 40.000, '5011007000218'),
    ('Johnnie Walker Black Label', 'Johnnie Walker', 'bottle', 0.700, 40.000, '5000267015777'),
    ('Beefeater London Dry Gin', 'Beefeater',     'bottle', 0.700, 40.000, '5010327104830'),
    ('Bacardi Carta Blanca',     'Bacardi',       'bottle', 0.700, 37.500, '5000219000172'),
    ('Château Margaux 2019',     'Château Margaux','bottle', 0.750, 13.500, '3350930000197'),
    ('Moët & Chandon Brut',      'Moët & Chandon','bottle', 0.750, 12.000, '3057640032593');

INSERT INTO merchant_offers (product_id, merchant_id, price_cents, currency, source_url, reliability, observed_at)
SELECT id, 'helsinki_premium', price, 'EUR', 'https://helsinkipremium.fi/tuote/' || id, 'EXACT', '2025-01-15T10:00:00+02:00'
FROM (VALUES
    (1,  3290),
    (2,  2590),
    (3,  3490),
    (4,  4490),
    (5,  5990),
    (6,  7490),
    (7,  3990),
    (8,  3790),
    (9,  45000),
    (10, 8990)
) AS t(id, price);

-- ---------------------------------------------------------------------------
-- Merchant: SuomiLogistiikka — Medium general importer
-- ---------------------------------------------------------------------------
INSERT INTO products (name, brand, container_type, volume_litres, alcohol_by_volume, ean)
VALUES
    ('Sandels Lager 24pk',       'Sandels',       'can',    0.330, 4.700,  '6411953111110'),
    ('Karjala 24pk',             'Karjala',       'can',    0.330, 4.600,  '6411953222220'),
    ('Lapin Kulta 24pk',         'Lapin Kulta',   'can',    0.330, 4.500,  '6411953333330'),
    ('Olvi 12pk',                'Olvi',          'can',    0.330, 4.500,  '6411953444440'),
    ('Koff 24pk',                'Koff',          'bottle', 0.330, 4.700,  '6411953555550'),
    ('Fanta Orange',             'Fanta',         'bottle', 1.500, NULL,    '5449000000996'),
    ('Coca-Cola 24pk',           'Coca-Cola',     'can',    0.330, NULL,    '5449000009999'),
    ('Bonduelle Herneet',        'Bonduelle',     'can',    0.400, NULL,    '6412400012340'),
    ('Kevytmaito',               'Valio',         'carton', 1.000, NULL,    '6410123456780'),
    ('Pirkka Pasta',             'Pirkka',        'pouch',  0.500, NULL,    '6412400056789');

INSERT INTO merchant_offers (product_id, merchant_id, price_cents, currency, source_url, reliability, observed_at)
SELECT id, 'suomi_logistiikka', price, 'EUR', 'https://suomilogistiikka.fi/product/' || id, 'EXACT', '2025-01-16T08:30:00+02:00'
FROM (VALUES
    (11, 3299),
    (12, 3099),
    (13, 2999),
    (14, 1899),
    (15, 3399),
    (16, 159),
    (17, 2899),
    (18, 99),
    (19, 129),
    (20, 89)
) AS t(id, price);

-- ---------------------------------------------------------------------------
-- Merchant: PohjolanTuonti — Small craft-beer specialist
-- ---------------------------------------------------------------------------
INSERT INTO products (name, brand, container_type, volume_litres, alcohol_by_volume, ean)
VALUES
    ('Põhjala Must Kuld',       'Põhjala',        'bottle', 0.330, 10.500, '4740079123451'),
    ('Põhjala Virmalised',      'Põhjala',        'bottle', 0.330, 8.000,  '4740079123468'),
    ('Sori Brewing Long Dreams','Sori Brewing',   'can',    0.440, 6.500,  '4740079222222'),
    ('Sori Brewing Citra IPA',  'Sori Brewing',   'can',    0.440, 5.500,  '4740079222239'),
    ('Mikkeller Green Gold',    'Mikkeller',      'can',    0.330, 8.000,  '5711833001234'),
    ('To Øl Garden of Eden',    'To Øl',          'can',    0.330, 6.800,  '5711833002239'),
    ('Fat Lizard Kama IPA',     'Fat Lizard',     'can',    0.440, 6.500,  '6438456000011'),
    ('Fat Lizard Saison',       'Fat Lizard',     'bottle', 0.750, 5.500,  '6438456000028');

INSERT INTO merchant_offers (product_id, merchant_id, price_cents, currency, source_url, reliability, observed_at)
SELECT id, 'pohjolan_tuonti', price, 'EUR', 'https://pohjolantuonti.fi/tuote/' || id, 'EXACT', '2025-01-17T12:00:00+02:00'
FROM (VALUES
    (21, 599),
    (22, 499),
    (23, 649),
    (24, 549),
    (25, 799),
    (26, 699),
    (27, 589),
    (28, 699)
) AS t(id, price);

-- ---------------------------------------------------------------------------
-- Merchant: ArcticBev — Large beverage importer (broad portfolio)
-- ---------------------------------------------------------------------------
INSERT INTO products (name, brand, container_type, volume_litres, alcohol_by_volume, ean)
VALUES
    ('Château Haut-Brion 2018', 'Château Haut-Brion','bottle', 0.750, 14.000, '3350930000198'),
    ('Penfolds Grange 2017',    'Penfolds',        'bottle', 0.750, 14.500, '9310297009197'),
    ('Veuve Clicquot Brut',     'Veuve Clicquot',  'bottle', 0.750, 12.000, '3057640050634'),
    ('Grey Goose Vodka',        'Grey Goose',      'bottle', 0.700, 40.000, '3100000000190'),
    ('Hennessy XO',             'Hennessy',        'bottle', 0.700, 40.000, '3100000000398'),
    ('Laphroaig 10 Year Old',   'Laphroaig',       'bottle', 0.700, 40.000, '5000213009105'),
    ('Chablis Premier Cru',     'Domaine Pattes Loup','bottle', 0.750, 12.500, '3760036481234'),
    ('Perrier-Jouët Belle Epoque','Perrier-Jouët', 'bottle', 0.750, 12.500, '3057640070632');

INSERT INTO merchant_offers (product_id, merchant_id, price_cents, currency, source_url, reliability, observed_at)
SELECT id, 'arctic_beverages', price, 'EUR', 'https://arcticbev.fi/tuote/' || id, 'EXACT', '2025-01-18T09:15:00+02:00'
FROM (VALUES
    (29, 68000),
    (30, 95000),
    (31, 12990),
    (32, 4590),
    (33, 38900),
    (34, 7990),
    (35, 5490),
    (36, 16990)
) AS t(id, price);

-- ---------------------------------------------------------------------------
-- Merchant: NordicTobacco — Specialized tobacco/nicotine importer
-- ---------------------------------------------------------------------------
INSERT INTO products (name, brand, container_type, volume_litres, alcohol_by_volume, ean)
VALUES
    ('Marlboro Red 200pk',      'Marlboro',        'carton', 0.100, NULL,    '6412400987654'),
    ('Marlboro Gold 200pk',     'Marlboro',        'carton', 0.100, NULL,    '6412400987655'),
    ('Cohiba Behike 56',        'Cohiba',          'box',    0.050, NULL,    '8100045678901'),
    ('Macanudo Hampton Court',  'Macanudo',        'box',    0.060, NULL,    '8100045678902'),
    ('Pueblo Classic 30g',      'Pueblo',          'pouch',  0.030, NULL,    '4041099001234'),
    ('White Cappuccino 50g',    'White',           'pouch',  0.050, NULL,    '4041099002345'),
    ('LYFT Freeze Slim',        'LYFT',            'can',    0.020, 0.000,   '7350056754321'),
    ('ZYN Nordic Citrus',       'ZYN',             'can',    0.020, 0.000,   '7350056755678');

INSERT INTO merchant_offers (product_id, merchant_id, price_cents, currency, source_url, reliability, observed_at)
SELECT id, 'nordic_tobacco', price, 'EUR', 'https://nordictobacco.fi/product/' || id, 'EXACT', '2025-01-19T14:00:00+02:00'
FROM (VALUES
    (37, 12990),
    (38, 12990),
    (39, 45000),
    (40, 19900),
    (41, 799),
    (42, 1299),
    (43, 699),
    (44, 699)
) AS t(id, price);

-- =============================================================================
-- 4. GOLDEN DATASET — pre-calculated scenarios for CI regression tests
-- =============================================================================
-- Each scenario exercises a specific calculation path.
-- expected_result contains ALL figures: excise, container_duty, transport, total.
-- =============================================================================

INSERT INTO calculation_audit (session_id, input_snapshot, result_snapshot, rate_version_id, disclaimer_language, calculated_at)
VALUES
-- SCENARIO 1: Standard spirits bottle (0.7L, 40% ABV) — HelsinkiPremium → DHL from DE
('golden-001', '{
    "scenario": "Standard spirit — Absolut Vodka 0.7L 40%",
    "merchant_id": "helsinki_premium",
    "carrier_id": "dhl_fi",
    "product": {"name": "Absolut Vodka", "volume_litres": 0.7, "alcohol_by_volume": 40.0, "container_type": "bottle"},
    "offer": {"price_cents": 3490, "reliability": "EXACT"},
    "transport": {"origin": "DE", "weight_kg": 1.2, "base_cents": 3500, "per_kg_cents": 1.2},
    "rate_version": "2025-01"
}', '{
    "excise": {"category": "spirits", "pure_alcohol_litres": 0.28, "rate_cents_per_litre": 274200, "amount_cents": 76776},
    "container_duty": {"type": "glass_bottle", "rate_cents": 0.10, "quantity": 1, "amount_cents": 0},
    "transport": {"base_cents": 3500, "weight_charge_cents": 144, "total_transport_cents": 3644},
    "merchant_price_cents": 3490,
    "total_estimated_cents": 83910,
    "total_estimated_eur": 839.10,
    "disclaimer": "Estimated total cost in Finland, not final legal tax liability"
}', 2, 'fi', '2025-06-15T10:00:00+03:00'),

-- SCENARIO 2: Strong beer case (24×0.33L, 4.7% ABV) — SuomiLogistiikka → Posti from EE
('golden-002', '{
    "scenario": "Beer case — Sandels 24×0.33L 4.7%",
    "merchant_id": "suomi_logistiikka",
    "carrier_id": "posti_freight",
    "product": {"name": "Sandels Lager 24pk", "volume_litres": 7.92, "alcohol_by_volume": 4.7, "container_type": "can"},
    "offer": {"price_cents": 3299, "reliability": "EXACT"},
    "transport": {"origin": "EE", "weight_kg": 8.5, "base_cents": 2500, "per_kg_cents": 0.85},
    "rate_version": "2025-01"
}', '{
    "excise": {"category": "beer_strong", "hectolitre_percent": 0.37224, "rate_cents_per_hlt_percent": 3710, "amount_cents": 1381},
    "container_duty": {"type": "aluminium_can", "rate_cents": 0.15, "quantity": 24, "amount_cents": 4, "deposit_system_exempt": false},
    "transport": {"base_cents": 2500, "weight_charge_cents": 723, "total_transport_cents": 3223},
    "merchant_price_cents": 3299,
    "total_estimated_cents": 7907,
    "total_estimated_eur": 79.07,
    "disclaimer": "Estimated total cost in Finland, not final legal tax liability"
}', 2, 'fi', '2025-06-15T10:05:00+03:00'),

-- SCENARIO 3: Fine wine (0.75L, 13.5% ABV) — HelsinkiPremium → DB Schenker from DE
('golden-003', '{
    "scenario": "Still wine — Château Margaux 2019 0.75L 13.5%",
    "merchant_id": "helsinki_premium",
    "carrier_id": "db_schenker",
    "product": {"name": "Château Margaux 2019", "volume_litres": 0.75, "alcohol_by_volume": 13.5, "container_type": "bottle"},
    "offer": {"price_cents": 45000, "reliability": "EXACT"},
    "transport": {"origin": "DE", "weight_kg": 1.5, "base_cents": 5500, "per_kg_cents": 0.75},
    "rate_version": "2025-01"
}', '{
    "excise": {"category": "wine_still", "amount_cents": 0, "note": "Still wine excise is €0 in Finland"},
    "container_duty": {"type": "glass_bottle", "rate_cents": 0.10, "quantity": 1, "amount_cents": 0},
    "transport": {"base_cents": 5500, "weight_charge_cents": 113, "total_transport_cents": 5613},
    "merchant_price_cents": 45000,
    "total_estimated_cents": 50613,
    "total_estimated_eur": 506.13,
    "disclaimer": "Estimated total cost in Finland, not final legal tax liability"
}', 2, 'fi', '2025-06-15T10:10:00+03:00'),

-- SCENARIO 4: Cigarettes (200pk) — NordicTobacco → DHL from DE
('golden-004', '{
    "scenario": "Cigarettes — Marlboro Red 200pk",
    "merchant_id": "nordic_tobacco",
    "carrier_id": "dhl_fi",
    "product": {"name": "Marlboro Red 200pk", "volume_litres": 0.1, "alcohol_by_volume": null, "container_type": "carton"},
    "offer": {"price_cents": 12990, "reliability": "EXACT"},
    "transport": {"origin": "DE", "weight_kg": 0.3, "base_cents": 3500, "per_kg_cents": 1.2},
    "rate_version": "2025-01"
}', '{
    "excise": {"category": "cigarettes", "quantity": 200, "rate_cents_per_1000": 66200, "amount_cents": 13240, "ad_valorem": false},
    "container_duty": {"type": "carton", "rate_cents": 0, "quantity": 1, "amount_cents": 0},
    "transport": {"base_cents": 3500, "weight_charge_cents": 36, "total_transport_cents": 3536},
    "merchant_price_cents": 12990,
    "total_estimated_cents": 29766,
    "total_estimated_eur": 297.66,
    "disclaimer": "Estimated total cost in Finland, not final legal tax liability"
}', 2, 'fi', '2025-06-15T10:15:00+03:00'),

-- SCENARIO 5: Craft beer (single 0.44L, 6.5% ABV) — PohjolanTuonti → Kaukokiito from EE
('golden-005', '{
    "scenario": "Craft beer single — Sori Brewing Long Dreams 0.44L 6.5%",
    "merchant_id": "pohjolan_tuonti",
    "carrier_id": "kaukokiito",
    "product": {"name": "Sori Brewing Long Dreams", "volume_litres": 0.44, "alcohol_by_volume": 6.5, "container_type": "can"},
    "offer": {"price_cents": 649, "reliability": "EXACT"},
    "transport": {"origin": "EE", "weight_kg": 0.5, "base_cents": 1800, "per_kg_cents": 0.5},
    "rate_version": "2025-01"
}', '{
    "excise": {"category": "beer_strong", "hectolitre_percent": 0.0286, "rate_cents_per_hlt_percent": 3710, "amount_cents": 106},
    "container_duty": {"type": "aluminium_can", "rate_cents": 0.15, "quantity": 1, "amount_cents": 0},
    "transport": {"base_cents": 1800, "weight_charge_cents": 25, "total_transport_cents": 1825},
    "merchant_price_cents": 649,
    "total_estimated_cents": 2580,
    "total_estimated_eur": 25.80,
    "disclaimer": "Estimated total cost in Finland, not final legal tax liability"
}', 2, 'fi', '2025-06-15T10:20:00+03:00'),

-- SCENARIO 6: Sparkling wine — ArcticBev → DHL from DE
('golden-006', '{
    "scenario": "Sparkling wine — Veuve Clicquot Brut 0.75L 12%",
    "merchant_id": "arctic_beverages",
    "carrier_id": "dhl_fi",
    "product": {"name": "Veuve Clicquot Brut", "volume_litres": 0.75, "alcohol_by_volume": 12.0, "container_type": "bottle"},
    "offer": {"price_cents": 12990, "reliability": "EXACT"},
    "transport": {"origin": "DE", "weight_kg": 1.5, "base_cents": 3500, "per_kg_cents": 1.2},
    "rate_version": "2025-01"
}', '{
    "excise": {"category": "wine_sparkling", "amount_cents": 0, "note": "Sparkling wine excise is €0 in Finland"},
    "container_duty": {"type": "glass_bottle", "rate_cents": 0.10, "quantity": 1, "amount_cents": 0},
    "transport": {"base_cents": 3500, "weight_charge_cents": 180, "total_transport_cents": 3680},
    "merchant_price_cents": 12990,
    "total_estimated_cents": 16670,
    "total_estimated_eur": 166.70,
    "disclaimer": "Estimated total cost in Finland, not final legal tax liability"
}', 2, 'fi', '2025-06-15T10:25:00+03:00'),

-- SCENARIO 7: Non-alcoholic product (no excise) — SuomiLogistiikka → Posti from EE
('golden-007', '{
    "scenario": "Non-alcoholic — Coca-Cola 24×0.33L",
    "merchant_id": "suomi_logistiikka",
    "carrier_id": "posti_freight",
    "product": {"name": "Coca-Cola 24pk", "volume_litres": 7.92, "alcohol_by_volume": null, "container_type": "can"},
    "offer": {"price_cents": 2899, "reliability": "EXACT"},
    "transport": {"origin": "EE", "weight_kg": 8.0, "base_cents": 2500, "per_kg_cents": 0.85},
    "rate_version": "2025-01"
}', '{
    "excise": {"category": "non_alcoholic", "amount_cents": 0, "note": "No excise on non-alcoholic products"},
    "container_duty": {"type": "aluminium_can", "rate_cents": 0.15, "quantity": 24, "amount_cents": 4, "deposit_system_exempt": false},
    "transport": {"base_cents": 2500, "weight_charge_cents": 680, "total_transport_cents": 3180},
    "merchant_price_cents": 2899,
    "total_estimated_cents": 6083,
    "total_estimated_eur": 60.83,
    "disclaimer": "Estimated total cost in Finland, not final legal tax liability"
}', 2, 'fi', '2025-06-15T10:30:00+03:00'),

-- SCENARIO 8: Premium whisky via sea freight — HelsinkiPremium → Maersk from USA
('golden-008', '{
    "scenario": "Premium spirits sea freight — Johnnie Walker Black 0.7L 40% from US",
    "merchant_id": "helsinki_premium",
    "carrier_id": "maersk_fi",
    "product": {"name": "Johnnie Walker Black Label", "volume_litres": 0.7, "alcohol_by_volume": 40.0, "container_type": "bottle"},
    "offer": {"price_cents": 7490, "reliability": "EXACT"},
    "transport": {"origin": "US", "weight_kg": 1.2, "base_cents": 72000, "per_kg_cents": 3.2},
    "rate_version": "2025-01"
}', '{
    "excise": {"category": "spirits", "pure_alcohol_litres": 0.28, "rate_cents_per_litre": 274200, "amount_cents": 76776},
    "container_duty": {"type": "glass_bottle", "rate_cents": 0.10, "quantity": 1, "amount_cents": 0},
    "transport": {"base_cents": 72000, "weight_charge_cents": 384, "total_transport_cents": 72384},
    "merchant_price_cents": 7490,
    "total_estimated_cents": 156650,
    "total_estimated_eur": 1566.50,
    "disclaimer": "Estimated total cost in Finland, not final legal tax liability"
}', 2, 'fi', '2025-06-15T10:35:00+03:00'),

-- SCENARIO 9: Intermediate product (aperitif) — ArcticBev → DSV from IT
('golden-009', '{
    "scenario": "Intermediate product — check intermediate category rate",
    "merchant_id": "arctic_beverages",
    "carrier_id": "dsv_fi",
    "product": {"name": "Sample Aperitif", "volume_litres": 0.75, "alcohol_by_volume": 18.0, "container_type": "bottle"},
    "offer": {"price_cents": 2490, "reliability": "EXACT"},
    "transport": {"origin": "IT", "weight_kg": 1.0, "base_cents": 4200, "per_kg_cents": 1.1},
    "rate_version": "2025-01"
}', '{
    "excise": {"category": "intermediate", "hectolitres": 0.0075, "rate_cents_per_hectolitre": 20950, "amount_cents": 157},
    "container_duty": {"type": "glass_bottle", "rate_cents": 0.10, "quantity": 1, "amount_cents": 0},
    "transport": {"base_cents": 4200, "weight_charge_cents": 110, "total_transport_cents": 4310},
    "merchant_price_cents": 2490,
    "total_estimated_cents": 6957,
    "total_estimated_eur": 69.57,
    "disclaimer": "Estimated total cost in Finland, not final legal tax liability"
}', 2, 'fi', '2025-06-15T10:40:00+03:00'),

-- SCENARIO 10: Standard beer (below strong threshold, 4.5%) — SuomiLogistiikka → VR from SE
('golden-010', '{
    "scenario": "Standard beer — Lapin Kulta 24×0.33L 4.5% (below strong threshold)",
    "merchant_id": "suomi_logistiikka",
    "carrier_id": "vr_transport",
    "product": {"name": "Lapin Kulta 24pk", "volume_litres": 7.92, "alcohol_by_volume": 4.5, "container_type": "bottle"},
    "offer": {"price_cents": 2999, "reliability": "EXACT"},
    "transport": {"origin": "SE", "weight_kg": 9.0, "base_cents": 3200, "per_kg_cents": 0.55},
    "rate_version": "2025-01"
}', '{
    "excise": {"category": "beer_standard", "hectolitre_percent": 0.3564, "rate_cents_per_hlt_percent": 3150, "amount_cents": 1123},
    "container_duty": {"type": "glass_bottle", "rate_cents": 0.10, "quantity": 24, "amount_cents": 2, "deposit_system_exempt": false},
    "transport": {"base_cents": 3200, "weight_charge_cents": 495, "total_transport_cents": 3695},
    "merchant_price_cents": 2999,
    "total_estimated_cents": 7819,
    "total_estimated_eur": 78.19,
    "disclaimer": "Estimated total cost in Finland, not final legal tax liability"
}', 2, 'fi', '2025-06-15T10:45:00+03:00'),

-- SCENARIO 11: Proposed 2026 rates — spirits increase impact (same as golden-001 but 2026 rates)
('golden-011', '{
    "scenario": "2026 proposed rate impact — Absolut Vodka 0.7L 40%",
    "merchant_id": "helsinki_premium",
    "carrier_id": "dhl_fi",
    "product": {"name": "Absolut Vodka", "volume_litres": 0.7, "alcohol_by_volume": 40.0, "container_type": "bottle"},
    "offer": {"price_cents": 3490, "reliability": "EXACT"},
    "transport": {"origin": "DE", "weight_kg": 1.2, "base_cents": 3500, "per_kg_cents": 1.2},
    "rate_version": "2026-PROPOSAL"
}', '{
    "excise": {"category": "spirits", "pure_alcohol_litres": 0.28, "rate_cents_per_litre": 288000, "amount_cents": 80640},
    "container_duty": {"type": "glass_bottle", "rate_cents": 0.12, "quantity": 1, "amount_cents": 0},
    "transport": {"base_cents": 3500, "weight_charge_cents": 144, "total_transport_cents": 3644},
    "merchant_price_cents": 3490,
    "total_estimated_cents": 87774,
    "total_estimated_eur": 877.74,
    "disclaimer": "Estimated total cost in Finland, not final legal tax liability"
}', 3, 'fi', '2025-08-01T10:00:00+03:00'),

-- SCENARIO 12: Non-alcoholic nicotine product pouches (2026 rates) — NordicTobacco → Posti from EE
('golden-012', '{
    "scenario": "Nicotine pouches (2026 proposed) — LYFT Freeze Slim 20g",
    "merchant_id": "nordic_tobacco",
    "carrier_id": "posti_freight",
    "product": {"name": "LYFT Freeze Slim", "volume_litres": 0.02, "alcohol_by_volume": 0.0, "container_type": "can"},
    "offer": {"price_cents": 699, "reliability": "EXACT"},
    "transport": {"origin": "EE", "weight_kg": 0.05, "base_cents": 2500, "per_kg_cents": 0.85},
    "rate_version": "2026-PROPOSAL"
}', '{
    "excise": {"category": "nicotine_pouches", "weight_grams": 20, "rate_cents_per_gram": 25, "amount_cents": 500, "note": "New nicotine category proposed for 2026"},
    "container_duty": {"type": "aluminium_can", "rate_cents": 0.18, "quantity": 1, "amount_cents": 0},
    "transport": {"base_cents": 2500, "weight_charge_cents": 4, "total_transport_cents": 2504},
    "merchant_price_cents": 699,
    "total_estimated_cents": 3703,
    "total_estimated_eur": 37.03,
    "disclaimer": "Estimated total cost in Finland, not final legal tax liability"
}', 3, 'fi', '2025-08-01T10:05:00+03:00');

-- =============================================================================
-- 5. STAGING REVIEW RECORDS — track rule-change review sessions
-- =============================================================================

INSERT INTO staging_reviews (review_label, previous_version_id, proposed_version_id, reviewer, status, created_at)
VALUES
    ('2024→2025 index adjustment',  1, 2, 'ops@rajahinta.fi',  'approved',     '2024-12-15T10:00:00+02:00'),
    ('2026 proposed rate change',   2, 3, NULL,                'pending',      '2025-08-01T10:00:00+03:00');

COMMIT;
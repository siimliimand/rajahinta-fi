/**
 * Staging fixtures for the D1 seed pipeline (task 2.6, change
 * migrate-to-cloudflare).
 *
 * Ported 1:1 from `infra/staging-data/seed.sql` (the PostgreSQL staging
 * fixture) — same rows, same order, same deterministic ids. The pg fixture
 * relies on two looseness points the D1 schema does not have, so this
 * module applies exactly two documented normalizations and nothing else:
 *
 * 1. Container type. `product_master.container_type` carries a closed
 *    value set; migration 0002_product_container_type_check widened it to
 *    the authoritative union (core-domain ContainerType + the fixture
 *    spellings 'can'/'bottle'), so most fixture values now pass verbatim.
 *    Two spellings remain outside the CHECK and are mapped — lossy, no
 *    faithful target exists:
 *
 *        box  → carton        pouch → carton
 *
 *    (Fixture 'bottle' and 'can' are stored verbatim.)
 *
 * 2. Reliability status. The fixture's "EXACT" is not in the closed value
 *    set shared by every reliability column (VERIFIED/ESTIMATED/STALE/
 *    UNAVAILABLE — the pg docblock and the D1 CHECK agree). EXACT → VERIFIED.
 *
 * All timestamps are pre-normalized to ISO-8601 UTC TEXT (design D2):
 * the fixture's `2024-01-01T00:00:00+02:00` is the same instant as
 * `2023-12-31T22:00:00.000Z`. Rows carry explicit deterministic ids so
 * retail_offers FK references and re-run idempotency (INSERT OR IGNORE on
 * the integer primary key) hold without reading generated ids back.
 *
 * Row order, prices, EANs, and merchant keys are NOT normalized — they are
 * the fixture's test data, copied verbatim from infra/staging-data/seed.sql.
 *
 * @module Seed/D1
 */

/** Product master fixture row (property names mirror d1/schema.ts). */
export interface StagingProductFixture {
  id: number;
  name: string;
  manufacturer: string;
  brand: string;
  category: string;
  alcoholByVolume: number | null;
  unitVolume: number;
  /** Authoritative post-migration-0002 value set (see module docblock). */
  containerType: 'glass' | 'plastic' | 'metal' | 'carton' | 'other' | 'can' | 'bottle';
  regulatoryClassification: string;
  depositSystemStatus: boolean;
  ean: string | null;
}

/** Transport offer fixture row (property names mirror d1/schema.ts). */
export interface StagingTransportFixture {
  id: number;
  carrier: string;
  originCountry: string;
  destinationCountry: string;
  weightMinKg: number;
  weightMaxKg: number;
  packageTier: 'parcel' | 'box' | 'pallet';
  priceCents: number;
  currency: string;
  sellerInvolvementIndicator: boolean;
  /** Carrier rate refresh instant, ISO-8601 UTC (fixture: 2024-01-01T00:00:00+02:00). */
  refreshedAt: string;
  reliabilityStatus: 'VERIFIED' | 'ESTIMATED';
}

/** Retail offer fixture row (property names mirror d1/schema.ts). */
export interface StagingRetailOfferFixture {
  id: number;
  merchant: string;
  country: string;
  productId: number;
  priceCents: number;
  currency: string;
  availability: string;
  sourceUrl: string;
  reliabilityStatus: 'VERIFIED';
}

/** Rule-change review record (staging-infra table, no Drizzle equivalent). */
export interface StagingReviewFixture {
  id: number;
  reviewLabel: string;
  previousVersionId: number | null;
  proposedVersionId: number | null;
  reviewer: string | null;
  status: 'pending' | 'approved';
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Transport offers — carrier shipping-cost data for common import routes.
// fixture: infra/staging-data/seed.sql §2 (ids 1–12 by file order)
// ---------------------------------------------------------------------------

export const STAGING_TRANSPORT_OFFERS: StagingTransportFixture[] = [
  { id: 1,  carrier: 'posti_freight', originCountry: 'EE', destinationCountry: 'FI', weightMinKg: 0.0,   weightMaxKg: 50.0,    packageTier: 'parcel', priceCents: 2500,  currency: 'EUR', sellerInvolvementIndicator: false, refreshedAt: '2023-12-31T22:00:00.000Z', reliabilityStatus: 'VERIFIED' },
  { id: 2,  carrier: 'posti_freight', originCountry: 'EE', destinationCountry: 'FI', weightMinKg: 50.0,  weightMaxKg: 500.0,   packageTier: 'pallet', priceCents: 4500,  currency: 'EUR', sellerInvolvementIndicator: false, refreshedAt: '2023-12-31T22:00:00.000Z', reliabilityStatus: 'VERIFIED' },
  { id: 3,  carrier: 'dhl_fi',        originCountry: 'DE', destinationCountry: 'FI', weightMinKg: 0.0,   weightMaxKg: 30.0,    packageTier: 'parcel', priceCents: 3500,  currency: 'EUR', sellerInvolvementIndicator: false, refreshedAt: '2023-12-31T22:00:00.000Z', reliabilityStatus: 'VERIFIED' },
  { id: 4,  carrier: 'dhl_fi',        originCountry: 'DE', destinationCountry: 'FI', weightMinKg: 30.0,  weightMaxKg: 300.0,   packageTier: 'box',    priceCents: 6500,  currency: 'EUR', sellerInvolvementIndicator: false, refreshedAt: '2023-12-31T22:00:00.000Z', reliabilityStatus: 'VERIFIED' },
  { id: 5,  carrier: 'db_schenker',   originCountry: 'DE', destinationCountry: 'FI', weightMinKg: 100.0, weightMaxKg: 2000.0,  packageTier: 'pallet', priceCents: 5500,  currency: 'EUR', sellerInvolvementIndicator: false, refreshedAt: '2023-12-31T22:00:00.000Z', reliabilityStatus: 'VERIFIED' },
  { id: 6,  carrier: 'db_schenker',   originCountry: 'NL', destinationCountry: 'FI', weightMinKg: 100.0, weightMaxKg: 2000.0,  packageTier: 'pallet', priceCents: 5800,  currency: 'EUR', sellerInvolvementIndicator: false, refreshedAt: '2023-12-31T22:00:00.000Z', reliabilityStatus: 'VERIFIED' },
  { id: 7,  carrier: 'maersk_fi',     originCountry: 'CN', destinationCountry: 'FI', weightMinKg: 500.0, weightMaxKg: 25000.0, packageTier: 'pallet', priceCents: 85000, currency: 'EUR', sellerInvolvementIndicator: false, refreshedAt: '2023-12-31T22:00:00.000Z', reliabilityStatus: 'VERIFIED' },
  { id: 8,  carrier: 'maersk_fi',     originCountry: 'US', destinationCountry: 'FI', weightMinKg: 500.0, weightMaxKg: 25000.0, packageTier: 'pallet', priceCents: 72000, currency: 'EUR', sellerInvolvementIndicator: false, refreshedAt: '2023-12-31T22:00:00.000Z', reliabilityStatus: 'VERIFIED' },
  { id: 9,  carrier: 'vr_transport',  originCountry: 'SE', destinationCountry: 'FI', weightMinKg: 0.0,   weightMaxKg: 1000.0,  packageTier: 'parcel', priceCents: 3200,  currency: 'EUR', sellerInvolvementIndicator: false, refreshedAt: '2023-12-31T22:00:00.000Z', reliabilityStatus: 'VERIFIED' },
  { id: 10, carrier: 'vr_transport',  originCountry: 'SE', destinationCountry: 'FI', weightMinKg: 1000.0, weightMaxKg: 10000.0, packageTier: 'pallet', priceCents: 5200, currency: 'EUR', sellerInvolvementIndicator: false, refreshedAt: '2023-12-31T22:00:00.000Z', reliabilityStatus: 'VERIFIED' },
  { id: 11, carrier: 'dsv_fi',        originCountry: 'IT', destinationCountry: 'FI', weightMinKg: 0.0,   weightMaxKg: 50.0,    packageTier: 'parcel', priceCents: 4200,  currency: 'EUR', sellerInvolvementIndicator: false, refreshedAt: '2023-12-31T22:00:00.000Z', reliabilityStatus: 'VERIFIED' },
  { id: 12, carrier: 'kaukokiito',    originCountry: 'EE', destinationCountry: 'FI', weightMinKg: 0.0,   weightMaxKg: 100.0,   packageTier: 'parcel', priceCents: 1800,  currency: 'EUR', sellerInvolvementIndicator: false, refreshedAt: '2023-12-31T22:00:00.000Z', reliabilityStatus: 'ESTIMATED' },
];

// ---------------------------------------------------------------------------
// Product master — 45 products, ids 1–45 by fixture file order.
// fixture: infra/staging-data/seed.sql §3 (five merchant blocks + standalone)
// ---------------------------------------------------------------------------

/** HelsinkiPremium Oy — Large alcohol importer (products 1–10) */
const HELSINKI_PREMIUM: StagingProductFixture[] = [
  { id: 1,  name: 'Koskenkorva Viina',         manufacturer: 'Koskenkorva',     brand: 'Koskenkorva',      category: 'spirits',          alcoholByVolume: 38.0,   unitVolume: 0.700, containerType: 'bottle', regulatoryClassification: 'alcoholic_beverage',      depositSystemStatus: false, ean: '6410600010101' },
  { id: 2,  name: 'Koskenkorva Salmiakki',     manufacturer: 'Koskenkorva',     brand: 'Koskenkorva',      category: 'spirits',          alcoholByVolume: 32.0,   unitVolume: 0.500, containerType: 'bottle',  regulatoryClassification: 'alcoholic_beverage',      depositSystemStatus: false, ean: '6410600010118' },
  { id: 3,  name: 'Absolut Vodka',             manufacturer: 'Absolut',         brand: 'Absolut',          category: 'spirits',          alcoholByVolume: 40.0,   unitVolume: 0.700, containerType: 'bottle',  regulatoryClassification: 'alcoholic_beverage',      depositSystemStatus: false, ean: '7312040017306' },
  { id: 4,  name: 'Absolut Original',          manufacturer: 'Absolut',         brand: 'Absolut',          category: 'spirits',          alcoholByVolume: 40.0,   unitVolume: 1.000, containerType: 'bottle',  regulatoryClassification: 'alcoholic_beverage',      depositSystemStatus: false, ean: '7312040017313' },
  { id: 5,  name: 'Jameson Irish Whiskey',     manufacturer: 'Jameson',         brand: 'Jameson',          category: 'spirits',          alcoholByVolume: 40.0,   unitVolume: 0.700, containerType: 'bottle',  regulatoryClassification: 'alcoholic_beverage',      depositSystemStatus: false, ean: '5011007000218' },
  { id: 6,  name: 'Johnnie Walker Black Label', manufacturer: 'Johnnie Walker', brand: 'Johnnie Walker',   category: 'spirits',          alcoholByVolume: 40.0,   unitVolume: 0.700, containerType: 'bottle',  regulatoryClassification: 'alcoholic_beverage',      depositSystemStatus: false, ean: '5000267015777' },
  { id: 7,  name: 'Beefeater London Dry Gin',  manufacturer: 'Beefeater',       brand: 'Beefeater',        category: 'spirits',          alcoholByVolume: 40.0,   unitVolume: 0.700, containerType: 'bottle',  regulatoryClassification: 'alcoholic_beverage',      depositSystemStatus: false, ean: '5010327104830' },
  { id: 8,  name: 'Bacardi Carta Blanca',      manufacturer: 'Bacardi',         brand: 'Bacardi',          category: 'spirits',          alcoholByVolume: 37.5,   unitVolume: 0.700, containerType: 'bottle',  regulatoryClassification: 'alcoholic_beverage',      depositSystemStatus: false, ean: '5000219000172' },
  { id: 9,  name: 'Château Margaux 2019',      manufacturer: 'Château Margaux', brand: 'Château Margaux',  category: 'wine_still',       alcoholByVolume: 13.5,   unitVolume: 0.750, containerType: 'bottle',  regulatoryClassification: 'alcoholic_beverage',      depositSystemStatus: false, ean: '3350930000197' },
  { id: 10, name: 'Moët & Chandon Brut',       manufacturer: 'Moët & Chandon',  brand: 'Moët & Chandon',   category: 'wine_sparkling',   alcoholByVolume: 12.0,   unitVolume: 0.750, containerType: 'bottle',  regulatoryClassification: 'alcoholic_beverage',      depositSystemStatus: false, ean: '3057640032593' },
];

/** SuomiLogistiikka — Medium general importer (products 11–20). Fixture values verbatim except product 20 (fixture pouch → carton). */
const SUOMI_LOGISTIIKKA: StagingProductFixture[] = [
  { id: 11, name: 'Sandels Lager 24pk',  manufacturer: 'Sandels',   brand: 'Sandels',   category: 'beer',           alcoholByVolume: 4.7, unitVolume: 0.330, containerType: 'can',    regulatoryClassification: 'alcoholic_beverage',      depositSystemStatus: true,  ean: '6411953111110' },
  { id: 12, name: 'Karjala 24pk',        manufacturer: 'Karjala',   brand: 'Karjala',   category: 'beer',           alcoholByVolume: 4.6, unitVolume: 0.330, containerType: 'can',    regulatoryClassification: 'alcoholic_beverage',      depositSystemStatus: true,  ean: '6411953222220' },
  { id: 13, name: 'Lapin Kulta 24pk',    manufacturer: 'Lapin Kulta', brand: 'Lapin Kulta', category: 'beer',         alcoholByVolume: 4.5, unitVolume: 0.330, containerType: 'can',    regulatoryClassification: 'alcoholic_beverage',      depositSystemStatus: true,  ean: '6411953333330' },
  { id: 14, name: 'Olvi 12pk',           manufacturer: 'Olvi',      brand: 'Olvi',      category: 'beer',           alcoholByVolume: 4.5, unitVolume: 0.330, containerType: 'can',    regulatoryClassification: 'alcoholic_beverage',      depositSystemStatus: true,  ean: '6411953444440' },
  { id: 15, name: 'Koff 24pk',           manufacturer: 'Koff',      brand: 'Koff',      category: 'beer',           alcoholByVolume: 4.7, unitVolume: 0.330, containerType: 'bottle', regulatoryClassification: 'alcoholic_beverage',      depositSystemStatus: true,  ean: '6411953555550' },
  { id: 16, name: 'Fanta Orange',        manufacturer: 'Fanta',     brand: 'Fanta',     category: 'non_alcoholic',  alcoholByVolume: null, unitVolume: 1.500, containerType: 'bottle', regulatoryClassification: 'non_alcoholic_beverage',  depositSystemStatus: true,  ean: '5449000000996' },
  { id: 17, name: 'Coca-Cola 24pk',      manufacturer: 'Coca-Cola', brand: 'Coca-Cola', category: 'non_alcoholic',  alcoholByVolume: null, unitVolume: 0.330, containerType: 'can',    regulatoryClassification: 'non_alcoholic_beverage',  depositSystemStatus: true,  ean: '5449000009999' },
  { id: 18, name: 'Bonduelle Herneet',   manufacturer: 'Bonduelle', brand: 'Bonduelle', category: 'non_alcoholic',  alcoholByVolume: null, unitVolume: 0.400, containerType: 'can',    regulatoryClassification: 'food_product',            depositSystemStatus: true,  ean: '6412400012340' },
  { id: 19, name: 'Kevytmaito',          manufacturer: 'Valio',     brand: 'Valio',     category: 'non_alcoholic',  alcoholByVolume: null, unitVolume: 1.000, containerType: 'carton', regulatoryClassification: 'non_alcoholic_beverage', depositSystemStatus: false, ean: '6410123456780' },
  { id: 20, name: 'Pirkka Pasta',        manufacturer: 'Pirkka',    brand: 'Pirkka',    category: 'non_alcoholic',  alcoholByVolume: null, unitVolume: 0.500, containerType: 'carton', regulatoryClassification: 'food_product',            depositSystemStatus: false, ean: '6412400056789' },
];

/** PohjolanTuonti — Small craft-beer specialist (products 21–28). Fixture values verbatim. */
const POHJOLAN_TUONTI: StagingProductFixture[] = [
  { id: 21, name: 'Põhjala Must Kuld',        manufacturer: 'Põhjala',      brand: 'Põhjala',      category: 'beer', alcoholByVolume: 10.5, unitVolume: 0.330, containerType: 'bottle', regulatoryClassification: 'alcoholic_beverage', depositSystemStatus: true, ean: '4740079123451' },
  { id: 22, name: 'Põhjala Virmalised',       manufacturer: 'Põhjala',      brand: 'Põhjala',      category: 'beer', alcoholByVolume: 8.0,  unitVolume: 0.330, containerType: 'bottle', regulatoryClassification: 'alcoholic_beverage', depositSystemStatus: true, ean: '4740079123468' },
  { id: 23, name: 'Sori Brewing Long Dreams', manufacturer: 'Sori Brewing', brand: 'Sori Brewing', category: 'beer', alcoholByVolume: 6.5,  unitVolume: 0.440, containerType: 'can',    regulatoryClassification: 'alcoholic_beverage', depositSystemStatus: true, ean: '4740079222222' },
  { id: 24, name: 'Sori Brewing Citra IPA',   manufacturer: 'Sori Brewing', brand: 'Sori Brewing', category: 'beer', alcoholByVolume: 5.5,  unitVolume: 0.440, containerType: 'can',    regulatoryClassification: 'alcoholic_beverage', depositSystemStatus: true, ean: '4740079222239' },
  { id: 25, name: 'Mikkeller Green Gold',     manufacturer: 'Mikkeller',    brand: 'Mikkeller',    category: 'beer', alcoholByVolume: 8.0,  unitVolume: 0.330, containerType: 'can',    regulatoryClassification: 'alcoholic_beverage', depositSystemStatus: true, ean: '5711833001234' },
  { id: 26, name: 'To Øl Garden of Eden',     manufacturer: 'To Øl',        brand: 'To Øl',        category: 'beer', alcoholByVolume: 6.8,  unitVolume: 0.330, containerType: 'can',    regulatoryClassification: 'alcoholic_beverage', depositSystemStatus: true, ean: '5711833002239' },
  { id: 27, name: 'Fat Lizard Kama IPA',      manufacturer: 'Fat Lizard',   brand: 'Fat Lizard',   category: 'beer', alcoholByVolume: 6.5,  unitVolume: 0.440, containerType: 'can',    regulatoryClassification: 'alcoholic_beverage', depositSystemStatus: true, ean: '6438456000011' },
  { id: 28, name: 'Fat Lizard Saison',        manufacturer: 'Fat Lizard',   brand: 'Fat Lizard',   category: 'beer', alcoholByVolume: 5.5,  unitVolume: 0.750, containerType: 'bottle', regulatoryClassification: 'alcoholic_beverage', depositSystemStatus: true, ean: '6438456000028' },
];

/** ArcticBev — Large beverage importer (products 29–36). Fixture bottles → glass. */
const ARCTIC_BEVERAGES: StagingProductFixture[] = [
  { id: 29, name: 'Château Haut-Brion 2018',    manufacturer: 'Château Haut-Brion', brand: 'Château Haut-Brion', category: 'wine_still',     alcoholByVolume: 14.0,   unitVolume: 0.750, containerType: 'bottle', regulatoryClassification: 'alcoholic_beverage', depositSystemStatus: false, ean: '3350930000198' },
  { id: 30, name: 'Penfolds Grange 2017',       manufacturer: 'Penfolds',           brand: 'Penfolds',           category: 'wine_still',     alcoholByVolume: 14.5,   unitVolume: 0.750, containerType: 'bottle', regulatoryClassification: 'alcoholic_beverage', depositSystemStatus: false, ean: '9310297009197' },
  { id: 31, name: 'Veuve Clicquot Brut',        manufacturer: 'Veuve Clicquot',     brand: 'Veuve Clicquot',     category: 'wine_sparkling', alcoholByVolume: 12.0,   unitVolume: 0.750, containerType: 'bottle', regulatoryClassification: 'alcoholic_beverage', depositSystemStatus: false, ean: '3057640050634' },
  { id: 32, name: 'Grey Goose Vodka',           manufacturer: 'Grey Goose',         brand: 'Grey Goose',         category: 'spirits',        alcoholByVolume: 40.0,   unitVolume: 0.700, containerType: 'bottle', regulatoryClassification: 'alcoholic_beverage', depositSystemStatus: false, ean: '3100000000190' },
  { id: 33, name: 'Hennessy XO',                manufacturer: 'Hennessy',           brand: 'Hennessy',           category: 'spirits',        alcoholByVolume: 40.0,   unitVolume: 0.700, containerType: 'bottle', regulatoryClassification: 'alcoholic_beverage', depositSystemStatus: false, ean: '3100000000398' },
  { id: 34, name: 'Laphroaig 10 Year Old',      manufacturer: 'Laphroaig',          brand: 'Laphroaig',          category: 'spirits',        alcoholByVolume: 40.0,   unitVolume: 0.700, containerType: 'bottle', regulatoryClassification: 'alcoholic_beverage', depositSystemStatus: false, ean: '5000213009105' },
  { id: 35, name: 'Chablis Premier Cru',        manufacturer: 'Domaine Pattes Loup', brand: 'Domaine Pattes Loup', category: 'wine_still',   alcoholByVolume: 12.5,   unitVolume: 0.750, containerType: 'bottle', regulatoryClassification: 'alcoholic_beverage', depositSystemStatus: false, ean: '3760036481234' },
  { id: 36, name: 'Perrier-Jouët Belle Epoque', manufacturer: 'Perrier-Jouët',      brand: 'Perrier-Jouët',      category: 'wine_sparkling', alcoholByVolume: 12.5,   unitVolume: 0.750, containerType: 'bottle', regulatoryClassification: 'alcoholic_beverage', depositSystemStatus: false, ean: '3057640070632' },
];

/** NordicTobacco — Specialized tobacco/nicotine importer (products 37–44). Fixture values verbatim except 39–42 (fixture box/pouch → carton). */
const NORDIC_TOBACCO: StagingProductFixture[] = [
  { id: 37, name: 'Marlboro Red 200pk',     manufacturer: 'Marlboro', brand: 'Marlboro', category: 'cigarettes',        alcoholByVolume: null, unitVolume: 0.100, containerType: 'carton', regulatoryClassification: 'tobacco_product',  depositSystemStatus: false, ean: '6412400987654' },
  { id: 38, name: 'Marlboro Gold 200pk',    manufacturer: 'Marlboro', brand: 'Marlboro', category: 'cigarettes',        alcoholByVolume: null, unitVolume: 0.100, containerType: 'carton', regulatoryClassification: 'tobacco_product',  depositSystemStatus: false, ean: '6412400987655' },
  { id: 39, name: 'Cohiba Behike 56',       manufacturer: 'Cohiba',   brand: 'Cohiba',   category: 'cigars',            alcoholByVolume: null, unitVolume: 0.050, containerType: 'carton', regulatoryClassification: 'tobacco_product',  depositSystemStatus: false, ean: '8100045678901' },
  { id: 40, name: 'Macanudo Hampton Court', manufacturer: 'Macanudo', brand: 'Macanudo', category: 'cigars',            alcoholByVolume: null, unitVolume: 0.060, containerType: 'carton', regulatoryClassification: 'tobacco_product',  depositSystemStatus: false, ean: '8100045678902' },
  { id: 41, name: 'Pueblo Classic 30g',     manufacturer: 'Pueblo',   brand: 'Pueblo',   category: 'fine_cut_tobacco',  alcoholByVolume: null, unitVolume: 0.030, containerType: 'carton', regulatoryClassification: 'tobacco_product',  depositSystemStatus: false, ean: '4041099001234' },
  { id: 42, name: 'White Cappuccino 50g',   manufacturer: 'White',    brand: 'White',    category: 'fine_cut_tobacco',  alcoholByVolume: null, unitVolume: 0.050, containerType: 'carton', regulatoryClassification: 'tobacco_product',  depositSystemStatus: false, ean: '4041099002345' },
  { id: 43, name: 'LYFT Freeze Slim',       manufacturer: 'LYFT',     brand: 'LYFT',     category: 'nicotine_pouches',  alcoholByVolume: 0.0,  unitVolume: 0.020, containerType: 'can',    regulatoryClassification: 'nicotine_product', depositSystemStatus: false, ean: '7350056754321' },
  { id: 44, name: 'ZYN Nordic Citrus',      manufacturer: 'ZYN',      brand: 'ZYN',      category: 'nicotine_pouches',  alcoholByVolume: 0.0,  unitVolume: 0.020, containerType: 'can',    regulatoryClassification: 'nicotine_product', depositSystemStatus: false, ean: '7350056755678' },
];

/** Standalone product (fixture: "Sample Aperitif", product_master_id 45, no EAN, no offer). */
const STANDALONE: StagingProductFixture[] = [
  { id: 45, name: 'Sample Aperitif', manufacturer: 'Generic', brand: 'Generic', category: 'intermediate_products', alcoholByVolume: 18.0, unitVolume: 0.750, containerType: 'bottle', regulatoryClassification: 'alcoholic_beverage', depositSystemStatus: false, ean: null },
];

export const STAGING_PRODUCTS: StagingProductFixture[] = [
  ...HELSINKI_PREMIUM,
  ...SUOMI_LOGISTIIKKA,
  ...POHJOLAN_TUONTI,
  ...ARCTIC_BEVERAGES,
  ...NORDIC_TOBACCO,
  ...STANDALONE,
];

// ---------------------------------------------------------------------------
// Retail offers — 44 rows, ids 1–44; FK product ids are the fixture's
// deterministic 1–45 product numbering (no reads back, no generated ids).
// fixture: infra/staging-data/seed.sql §3 (per-merchant VALUES lists)
// fixture reliability "EXACT" → VERIFIED (closed value set; see module doc)
// ---------------------------------------------------------------------------

interface OfferBlock {
  merchant: string;
  country: string;
  sourceUrlBase: string;
  /** [productId, priceCents] in fixture order — ids assigned 1-based per block sequence. */
  offers: Array<readonly [number, number]>;
}

const OFFER_BLOCKS: OfferBlock[] = [
  { merchant: 'helsinki_premium', country: 'EE', sourceUrlBase: 'https://helsinkipremium.fi/tuote/',     offers: [[1, 3290], [2, 2590], [3, 3490], [4, 4490], [5, 5990], [6, 7490], [7, 3990], [8, 3790], [9, 45000], [10, 8990]] },
  { merchant: 'suomi_logistiikka', country: 'FI', sourceUrlBase: 'https://suomilogistiikka.fi/product/', offers: [[11, 3299], [12, 3099], [13, 2999], [14, 1899], [15, 3399], [16, 159], [17, 2899], [18, 99], [19, 129], [20, 89]] },
  { merchant: 'pohjolan_tuonti',  country: 'EE', sourceUrlBase: 'https://pohjolantuonti.fi/tuote/',      offers: [[21, 599], [22, 499], [23, 649], [24, 549], [25, 799], [26, 699], [27, 589], [28, 699]] },
  { merchant: 'arctic_beverages', country: 'EE', sourceUrlBase: 'https://arcticbev.fi/tuote/',           offers: [[29, 68000], [30, 95000], [31, 12990], [32, 4590], [33, 38900], [34, 7990], [35, 5490], [36, 16990]] },
  { merchant: 'nordic_tobacco',   country: 'EE', sourceUrlBase: 'https://nordictobacco.fi/product/',     offers: [[37, 12990], [38, 12990], [39, 45000], [40, 19900], [41, 799], [42, 1299], [43, 699], [44, 699]] },
];

export const STAGING_RETAIL_OFFERS: StagingRetailOfferFixture[] =
  OFFER_BLOCKS.flatMap((block, blockIndex) => {
    // Offer ids continue across blocks: block 0 → 1–10, block 1 → 11–20, …
    const idOffset = OFFER_BLOCKS.slice(0, blockIndex)
      .reduce((sum, b) => sum + b.offers.length, 0);
    return block.offers.map(([productId, priceCents], i) => ({
      id: idOffset + i + 1,
      merchant: block.merchant,
      country: block.country,
      productId,
      priceCents,
      currency: 'EUR',
      availability: 'in_stock',
      sourceUrl: `${block.sourceUrlBase}${productId}`,
      reliabilityStatus: 'VERIFIED' as const,
    }));
  });

// ---------------------------------------------------------------------------
// Staging review records — fixture: infra/staging-data/seed.sql §4.
// The staging_reviews table itself is staging-infra only (no Drizzle
// equivalent, per ARCHITECTURE.md §15.1); its SQLite DDL is emitted by
// generate.ts alongside these rows, mirroring the pg deploy order
// (migrations → staging-reviews.sql → seed).
// ---------------------------------------------------------------------------

export const STAGING_REVIEWS: StagingReviewFixture[] = [
  { id: 1, reviewLabel: '2024→2025 index adjustment', previousVersionId: null, proposedVersionId: null, reviewer: 'ops@rajahinta.fi', status: 'approved', createdAt: '2024-12-15T08:00:00.000Z' },
  { id: 2, reviewLabel: '2026 proposed rate change',  previousVersionId: null, proposedVersionId: null, reviewer: null,               status: 'pending',  createdAt: '2025-08-01T07:00:00.000Z' },
];
